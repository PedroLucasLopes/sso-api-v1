import {
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  OnApplicationBootstrap,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request, Response } from 'express';
import * as crypto from 'node:crypto';
import { Method, ProjectStatus } from 'generated/prisma/enums';
import { PrismaService } from 'src/global/prisma/prisma.service';
import {
  SSO_CSRF_HEADER,
  SSO_SESSION_COOKIE,
} from 'src/routes/auth/auth.constant';
import { SsoSessionCookie } from 'src/routes/auth/dto/pkceTransaction.dto';
import { CookieService } from '../cookie/cookie.service';
import {
  SSO_ROOT_ROLE,
  SSO_SELF_PROJECT_NAME,
} from '../constants/selfProject.constant';
import { SSO_ROUTE_PREFIX } from '../constants/routePrefix.constant';
import { AdminIdentity } from './adminIdentity.dto';
import { AdminRoutesService } from './adminRoutes.service';

interface SelfProject {
  id: string;
  clientId: string;
}

interface AccessTokenClaims {
  iss?: string;
  aud?: string | string[];
  sub?: string;
  jti?: string;
  exp?: number;
  nbf?: number;
}

type Credential =
  | { via: 'bearer'; userId: string; reference: string }
  | {
      via: 'session';
      userId: string;
      reference: string;
      csrfToken: string | undefined;
    };

/** Metodos que nao mudam estado. So estes passam sem token anti-CSRF. */
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Quem pode agir nas rotas administrativas do SSO, e em quais delas.
 *
 * Substitui os segredos estaticos `SSO_ADMIN_SECRET` e `SSO_SUPERADMIN_SECRET`.
 * Um segredo em header nao diz QUEM agiu, nao da para revogar para uma pessoa
 * so, e quem tem acesso ao repositorio vira administrador de fato. Aqui a
 * resposta vem toda do banco: a credencial diz quem e, e `ProjectUser`, `Role`
 * e `Permission` dizem o que essa pessoa pode.
 *
 * ## Duas credenciais, a mesma autorizacao
 *
 * - **`Authorization: Bearer`**, emitido para o projeto do SSO. E o caminho da
 *   linha de comando e dos testes.
 * - **Cookie de sessao do SSO.** E o caminho do console, que mora na mesma
 *   origem da API e se autentica pela propria sessao (RFC 10017 secao 7.1).
 *   Nenhum token chega ao JavaScript dele.
 *
 * O que muda entre as duas e so a identificacao. O papel, as permissoes e a
 * checagem por rota sao exatamente os mesmos, relidos do banco a cada pedido.
 *
 * ## A raiz
 *
 * O papel SUPERADMIN do projeto `SSO` alcanca toda rota administrativa sem
 * consultar o catalogo. E o que permite, num banco novo, cadastrar a primeira
 * rota: sem raiz, ninguem teria permissao para criar a primeira permissao. Os
 * outros papeis dependem de `Route` e `Permission`, cadastrados no console.
 *
 * O SSO e um `Project` de si mesmo, criado pelo SQL de primeira subida de cada
 * ambiente, junto do primeiro SUPERADMIN. Nao ha script nem seed para isso.
 */
@Injectable()
export class AdminAccessService implements OnApplicationBootstrap {
  private readonly logger = new Logger(AdminAccessService.name);
  private readonly issuer: string;
  private readonly prefix = `/${SSO_ROUTE_PREFIX}`;

  /** O projeto do proprio SSO nao muda de id; a lista de permissoes muda. */
  private selfProject: SelfProject | null = null;

  private readonly matchers = new Map<string, RegExp>();

  constructor(
    private prisma: PrismaService,
    private cookies: CookieService,
    private adminRoutes: AdminRoutesService,
    config: ConfigService,
  ) {
    this.issuer = config.getOrThrow<string>('SSO_ISSUER').replace(/\/+$/, '');
  }

  /**
   * O SSO nao sobe sem o que o SQL de primeira subida cria: o projeto `SSO`
   * ativo, um SUPERADMIN e uma redirect URI para o console. De pe sem isso, ele
   * seria um servidor que ninguem consegue administrar.
   */
  async onApplicationBootstrap(): Promise<void> {
    const project = await this.prisma.project.findUnique({
      where: { name: SSO_SELF_PROJECT_NAME },
      select: {
        status: true,
        _count: { select: { redirectUris: true } },
        projectUsers: {
          where: { role: { name: SSO_ROOT_ROLE } },
          select: { userId: true },
          take: 1,
        },
      },
    });

    const faltando: string[] = [];

    if (!project) {
      faltando.push(`o projeto "${SSO_SELF_PROJECT_NAME}"`);
    } else {
      if (project.status !== ProjectStatus.ACTIVE) {
        faltando.push(`o projeto "${SSO_SELF_PROJECT_NAME}" ativo`);
      }

      if (project.projectUsers.length === 0) {
        faltando.push(`um usuario com o papel ${SSO_ROOT_ROLE}`);
      }

      if (project._count.redirectUris === 0) {
        faltando.push('uma redirect URI para o console');
      }
    }

    if (faltando.length > 0) {
      throw new Error(
        `o SSO nao sobe sem ${faltando.join(', ')}. ` +
          'Rode o SQL de primeira subida deste ambiente.',
      );
    }
  }

  /**
   * Identifica quem chamou e resolve a identidade contra o banco.
   *
   * Com `Authorization` presente, vale so ele: um header ruim devolve 401 em
   * vez de cair para o cookie, senao o cliente que errou o token nunca saberia.
   *
   * A claim `roles` do token e ignorada de proposito. Ela e verdadeira, mas
   * congelada no momento da emissao: tirar o papel de alguem so faria efeito
   * quando o access token expirasse. Para a superficie administrativa do
   * proprio SSO isso e tempo demais, entao o papel e relido a cada pedido.
   *
   * `hideMembership` troca o 403 de quem nao tem papel no SSO pelo 404 de rota
   * que nao existe. So o `/me` fica sem ele, porque o console precisa saber
   * que falta papel para mostrar a tela de sem acesso.
   */
  async authenticate(
    request: Request,
    response?: Response,
    options: { hideMembership?: boolean } = {},
  ): Promise<AdminIdentity> {
    const credential: Credential =
      request.headers.authorization !== undefined
        ? await this.fromBearer(request)
        : await this.fromSession(request, response);

    const project = await this.resolveSelfProject();

    const membership = await this.prisma.projectUser.findUnique({
      where: {
        userId_projectId: {
          userId: credential.userId,
          projectId: project.id,
        },
      },
      include: { role: true, user: true },
    });

    if (!membership) {
      if (options.hideMembership) {
        throw this.notFound(request);
      }

      throw new ForbiddenException(
        'usuario sem vinculo com o projeto administrativo do SSO',
      );
    }

    return {
      userId: membership.user.id,
      email: membership.user.email,
      name: membership.user.name,
      role: membership.role.name,
      root: membership.role.name === SSO_ROOT_ROLE,
      tokenId: credential.reference,
      via: credential.via,
      csrfToken:
        credential.via === 'session' ? credential.csrfToken : undefined,
    };
  }

  /**
   * Barra escrita forjada quando a credencial veio do cookie.
   *
   * O navegador anexa o cookie sozinho, inclusive quando outro site dispara a
   * requisicao. Bearer nao tem esse problema, porque o navegador nunca o anexa.
   * Por isso a checagem vale so para sessao e so para metodo que muda estado.
   *
   * Duas barreiras, a mesma defesa do `sso-client`:
   * 1. **Token de dupla submissao.** A copia que vale mora dentro do cookie
   *    cifrado; a legivel chega no header. Quem so consegue gravar cookie no
   *    dominio nao produz um par que bata. Comparacao em tempo constante.
   * 2. **`Origin`**, recusado quando presente e diferente do console ou do
   *    proprio SSO. A lista vem das `redirect_uri` do projeto, no banco.
   */
  async assertSessionWrite(
    request: Request,
    identity: AdminIdentity,
  ): Promise<void> {
    if (identity.via !== 'session') return;
    if (SAFE_METHODS.has(request.method.toUpperCase())) return;

    const header = request.headers[SSO_CSRF_HEADER];

    if (
      !identity.csrfToken ||
      typeof header !== 'string' ||
      !this.safeEqual(header, identity.csrfToken)
    ) {
      this.logger.warn(
        `escrita sem token anti-CSRF valido: ${identity.email} em ${request.method} ${request.path}`,
      );

      throw new ForbiddenException({
        error: 'csrf_token_invalid',
        message: 'escrita autenticada por sessao exige o header X-CSRF-Token',
      });
    }

    const origin = request.headers.origin;

    if (origin !== undefined && !(await this.consoleOrigins()).has(origin)) {
      this.logger.warn(`escrita de origem nao autorizada: ${origin}`);

      throw new ForbiddenException({
        error: 'origin_not_allowed',
        message: `a origem ${origin} nao pertence ao console do SSO`,
      });
    }
  }

  /**
   * Confere se a identidade alcanca esta rota. A raiz passa direto; os outros
   * papeis precisam de `Permission` casando metodo e caminho.
   *
   * Sem permissao a resposta e 404, a mesma de um caminho que nao existe, e nao
   * 403: quem nao pode usar a rota nao descobre que ela existe. A RFC 9110,
   * secao 15.5.4, preve exatamente isso.
   *
   * Consulta o banco a cada requisicao, sem cache. A superficie
   * administrativa tem trafego baixo e o preco de uma consulta indexada e
   * menor do que o de uma permissao revogada continuar valendo.
   */
  async authorize(request: Request, identity: AdminIdentity): Promise<void> {
    if (identity.root) return;

    if (await this.reaches(identity, request.method, request.path)) return;

    this.logger.warn(
      `negado: ${identity.email} (${identity.role}) em ${request.method} ${this.normalize(request.path)}`,
    );

    throw this.notFound(request);
  }

  /**
   * Rotas que esta identidade alcanca. Alimenta `GET /sso/me`, de onde o
   * console tira menu, abas e acoes.
   *
   * Para a raiz, toda rota administrativa que o servidor expoe, lida do proprio
   * roteador: ela alcanca todas sem depender do catalogo, e num ambiente novo o
   * catalogo ainda esta vazio. Para os outros papeis, so o que `Permission`
   * concede.
   */
  async permissionsFor(
    identity: AdminIdentity,
  ): Promise<{ path: string; method: Method }[]> {
    if (identity.root) {
      return this.adminRoutes.all();
    }

    const project = await this.resolveSelfProject();

    const permissions = await this.prisma.permission.findMany({
      where: {
        role: { name: identity.role, projectId: project.id },
        route: { projectId: project.id },
      },
      include: { route: true },
      orderBy: { route: { path: 'asc' } },
    });

    return permissions.map(({ route }) => ({
      path: route.path,
      method: route.method,
    }));
  }

  /** Esvazia o cache do projeto, para o caso de ele ser recriado com o SSO de pe. */
  forgetSelfProject(): void {
    this.selfProject = null;
  }

  /** O mesmo 404 que o roteador do Nest devolve para um caminho inexistente. */
  notFound(request: Request): NotFoundException {
    return new NotFoundException(
      `Cannot ${request.method} ${request.originalUrl}`,
    );
  }

  private async reaches(
    identity: AdminIdentity,
    httpMethod: string,
    path: string,
  ): Promise<boolean> {
    const method = this.toMethod(httpMethod);

    if (!method) return false;

    const project = await this.resolveSelfProject();

    const permissions = await this.prisma.permission.findMany({
      where: {
        role: { name: identity.role, projectId: project.id },
        route: { projectId: project.id, method },
      },
      include: { route: true },
    });

    const target = this.normalize(path);

    return permissions.some((permission) =>
      this.matcher(permission.route.path).test(target),
    );
  }

  private async fromBearer(request: Request): Promise<Credential> {
    const claims = await this.verifyBearer(request);

    return {
      via: 'bearer',
      userId: claims.sub as string,
      reference: claims.jti as string,
    };
  }

  /**
   * Identidade a partir do cookie de sessao do SSO.
   *
   * A sessao e relida do banco, entao logout e revogacao valem na hora, sem
   * nenhum prazo de token para esperar.
   */
  private async fromSession(
    request: Request,
    response?: Response,
  ): Promise<Credential> {
    const cookie = this.cookies.get<SsoSessionCookie>(
      request,
      SSO_SESSION_COOKIE,
    );

    if (!cookie?.authSessionId) {
      throw new UnauthorizedException('credencial ausente');
    }

    const session = await this.prisma.authSession.findUnique({
      where: { id: cookie.authSessionId },
    });

    if (
      !session ||
      session.revokedAt ||
      session.expiresAt.getTime() <= Date.now()
    ) {
      throw new UnauthorizedException('sessao expirada ou encerrada');
    }

    let csrfToken = cookie.csrf;

    // Sessao criada antes da defesa de CSRF chega sem token. Ganha um agora,
    // com o prazo que ainda resta a ela: renovar o cookie por inteiro
    // estenderia a sessao alem do que o banco permite.
    if (!csrfToken && response) {
      csrfToken = crypto.randomBytes(32).toString('base64url');

      const remainingSeconds = Math.max(
        1,
        Math.floor((session.expiresAt.getTime() - Date.now()) / 1000),
      );

      this.cookies.set(
        response,
        SSO_SESSION_COOKIE,
        {
          authSessionId: session.id,
          csrf: csrfToken,
        } satisfies SsoSessionCookie,
        remainingSeconds,
      );
    }

    return {
      via: 'session',
      userId: session.userId,
      reference: `session:${session.id}`,
      csrfToken,
    };
  }

  private async verifyBearer(request: Request): Promise<AccessTokenClaims> {
    const header = request.headers.authorization;

    if (!header?.startsWith('Bearer ')) {
      throw new UnauthorizedException('credencial ausente');
    }

    const token = header.slice('Bearer '.length).trim();
    const parts = token.split('.');

    if (parts.length !== 3) {
      throw new UnauthorizedException('access token malformado');
    }

    const [encodedHeader, encodedPayload, encodedSignature] = parts;
    const jwtHeader = this.decode<{ alg?: string; kid?: string }>(
      encodedHeader,
    );

    // `alg` fixo no que o AS emite. Aceitar o que vem escrito no token e como
    // se abre a confusao de algoritmo, inclusive `none`.
    if (!jwtHeader || jwtHeader.alg !== 'RS256' || !jwtHeader.kid) {
      throw new UnauthorizedException('cabecalho do token invalido');
    }

    const signingKey = await this.prisma.signingKey.findUnique({
      where: { id: jwtHeader.kid },
    });

    if (!signingKey) {
      throw new UnauthorizedException('kid desconhecido');
    }

    const verified = crypto.verify(
      'sha256',
      Buffer.from(`${encodedHeader}.${encodedPayload}`),
      crypto.createPublicKey(signingKey.publicKeyPem),
      Buffer.from(encodedSignature, 'base64url'),
    );

    if (!verified) {
      throw new UnauthorizedException('assinatura do token invalida');
    }

    const claims = this.decode<AccessTokenClaims>(encodedPayload);

    if (!claims?.sub || !claims.jti) {
      throw new UnauthorizedException('token sem sub ou jti');
    }

    if (claims.iss !== this.issuer) {
      throw new UnauthorizedException('emissor do token nao e este SSO');
    }

    const now = Math.floor(Date.now() / 1000);

    if (typeof claims.exp !== 'number' || claims.exp <= now) {
      throw new UnauthorizedException('access token expirado');
    }

    if (typeof claims.nbf === 'number' && claims.nbf > now) {
      throw new UnauthorizedException('access token ainda nao vale');
    }

    const project = await this.resolveSelfProject();
    const audiences = Array.isArray(claims.aud)
      ? claims.aud
      : [claims.aud ?? ''];

    // Sem esta conferencia o token que o krloc recebe abriria a administracao
    // do SSO: mesma assinatura, mesmo emissor, outro publico.
    if (!audiences.includes(project.clientId)) {
      throw new UnauthorizedException(
        'este token foi emitido para outra aplicacao',
      );
    }

    return claims;
  }

  /**
   * Origens que podem escrever com a sessao: a do proprio SSO e as das
   * `redirect_uri` do projeto `SSO`. Lidas do banco, como o resto do acesso.
   */
  private async consoleOrigins(): Promise<Set<string>> {
    const project = await this.resolveSelfProject();

    const uris = await this.prisma.redirectUri.findMany({
      where: { projectId: project.id },
      select: { redirectUri: true },
    });

    const origins = new Set<string>([new URL(this.issuer).origin]);

    for (const { redirectUri } of uris) {
      try {
        origins.add(new URL(redirectUri).origin);
      } catch {
        // URI malformada no cadastro nao abre origem nenhuma.
      }
    }

    return origins;
  }

  private async resolveSelfProject(): Promise<SelfProject> {
    if (this.selfProject) return this.selfProject;

    const project = await this.prisma.project.findUnique({
      where: { name: SSO_SELF_PROJECT_NAME },
      select: { id: true, clientId: true },
    });

    if (!project) {
      throw new UnauthorizedException(
        `o projeto "${SSO_SELF_PROJECT_NAME}" nao existe neste banco; ` +
          'rode o SQL de primeira subida do ambiente',
      );
    }

    this.selfProject = project;

    return project;
  }

  private safeEqual(a: string, b: string): boolean {
    const left = Buffer.from(a);
    const right = Buffer.from(b);

    return left.length === right.length && crypto.timingSafeEqual(left, right);
  }

  private decode<T>(segment: string): T | null {
    try {
      return JSON.parse(
        Buffer.from(segment, 'base64url').toString('utf8'),
      ) as T;
    } catch {
      return null;
    }
  }

  private toMethod(httpMethod: string): Method | null {
    const upper = httpMethod.toUpperCase();

    return upper in Method ? (upper as Method) : null;
  }

  /**
   * O padrao e montado a partir do caminho GUARDADO, nunca do caminho pedido.
   * Ja houve o contrario no krloc: `new RegExp(req.path)` deixava um pedido a
   * `/api/.*` casar com qualquer permissao.
   */
  private matcher(permissionPath: string): RegExp {
    const cached = this.matchers.get(permissionPath);

    if (cached) return cached;

    const pattern = this.normalize(permissionPath)
      .split('/')
      .map((segment) => {
        if (segment.startsWith(':')) return '[^/]+';
        if (segment === '*') return '[^/]*';
        return segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      })
      .join('/');

    const matcher = new RegExp(`^${pattern}$`);

    this.matchers.set(permissionPath, matcher);

    return matcher;
  }

  /** Tira o prefixo global e a barra final, para comparar com a tabela `Route`. */
  private normalize(path: string): string {
    let normalized = path;

    /* Recorta na FRONTEIRA. Sem o teste do proximo caractere, `/ssouser`
     * viraria `/user` e um caminho que nao e desta aplicacao casaria com
     * uma permissao dela. Hoje o roteador do Nest nao deixa chegar aqui,
     * mas a normalizacao nao deve depender disso. */
    const prefixo = this.prefix;

    if (
      prefixo &&
      normalized.startsWith(prefixo) &&
      (normalized.length === prefixo.length ||
        normalized[prefixo.length] === '/')
    ) {
      normalized = normalized.slice(prefixo.length);
    }

    normalized = normalized.replace(/\/{2,}/g, '/');

    if (normalized.length > 1) {
      normalized = normalized.replace(/\/+$/, '');
    }

    return normalized.startsWith('/') ? normalized : `/${normalized}`;
  }
}
