import {
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'node:crypto';
import { Request, Response } from 'express';
import { Project } from 'generated/prisma/client';
import { ProjectStatus } from 'generated/prisma/enums';
import { PrismaService } from 'src/global/prisma/prisma.service';
import { CookieService } from 'src/global/cookie/cookie.service';
import { SSO_SELF_PROJECT_NAME } from 'src/global/constants/selfProject.constant';
import {
  SSO_CSRF_HEADER,
  SSO_SESSION_COOKIE,
  SSO_TX_COOKIE,
  TX_COOKIE_TTL_SECONDS,
} from '../auth.constant';
import { Authorize, PKCE_PATTERN } from '../dto/authorize.dto';
import { GoogleUser } from '../dto/googleUser';
import { Introspect, IntrospectionResponse } from '../dto/introspect.dto';
import { LoginRequestView } from '../dto/loginRequest.dto';
import {
  LoginTransaction,
  PkceTransaction,
  SessionTransaction,
  SsoSessionCookie,
} from '../dto/pkceTransaction.dto';
import { PermissionSet, ResolvePermissions } from '../dto/permissionSet.dto';
import { Revoke } from '../dto/revoke.dto';
import { SessionLogin, STATE_PATTERN } from '../dto/sessionLogin.dto';
import { SessionView } from '../dto/sessionView.dto';
import { Token } from '../dto/token.dto';
import { TokenResponse } from '../dto/tokenResponse.dto';
import { LoginPageRedirectException } from '../error/loginPage.exception';
import {
  AuthorizeRedirectException,
  OAuthErrorCode,
  OAuthException,
} from '../error/oauth.exception';
import { SigningKeyService } from 'src/routes/Key/Service/signingKey.service';
import { AuthSessionService } from './authSession.service';
import { PermissionSetService } from './permissionSet.service';
import { AuthorizationCodeService } from './authorizationCode.service';
import { ClientAuthService } from './clientAuth.service';
import { LoginPageService } from './loginPage.service';
import { RefreshTokenService } from './refreshToken.service';
import { TokenIssuerService } from './tokenIssuer.service';

/**
 * Orquestra o Authorization Code + PKCE.
 *
 * Mudancas em relacao a versao anterior, todas vindas das RFCs:
 *  - o estado de transacao saiu do Redis para um cookie cifrado, o que amarra
 *    o fluxo ao navegador (RFC 9700 secao 2.1) em vez de a um `state` que o
 *    cliente escolhe;
 *  - o authorization code foi para o Postgres, com uso unico atomico
 *    (RFC 6749 secao 4.1.2) e revogacao em caso de reapresentacao
 *    (RFC 9700 secao 2.1.1);
 *  - erros seguem o formato e a ordem das secoes 4.1.2.1 e 5.2 da RFC 6749;
 *  - existe uma sessao do usuario com o proprio SSO, que e o que torna este
 *    servidor de fato single sign-on.
 *
 * ## A tela de login so existe dentro de um pedido
 *
 * Sem sessao, ninguem vai direto ao Google: a pessoa passa pela tela de login
 * do front, a interface do IdP, que mostra em qual aplicacao ela esta entrando.
 * E essa tela so oferece login quando ha um pedido pendente, criado por uma
 * aplicacao que viu alguem sem sessao. Visitada direto, ela nao faz nada.
 */
@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private readonly issuer: string;
  private readonly basePath: string;

  constructor(
    private prisma: PrismaService,
    private cookies: CookieService,
    private authSessions: AuthSessionService,
    private codes: AuthorizationCodeService,
    private refreshTokens: RefreshTokenService,
    private tokenIssuer: TokenIssuerService,
    private clientAuth: ClientAuthService,
    private permissionSets: PermissionSetService,
    private signingKeys: SigningKeyService,
    private loginPage: LoginPageService,
    config: ConfigService,
  ) {
    this.issuer = config.getOrThrow<string>('SSO_ISSUER').replace(/\/+$/, '');
    this.basePath = new URL(this.issuer).pathname.replace(/\/+$/, '');
  }

  // ------------------------------------------------------------------ //
  // Authorization endpoint
  // ------------------------------------------------------------------ //

  async beginAuthorization(
    query: Authorize,
    req: Request,
    res: Response,
  ): Promise<void> {
    const project = await this.prisma.project.findUnique({
      where: { clientId: query.client_id },
      include: { redirectUris: { select: { redirectUri: true } } },
    });

    // RFC 6749 secao 4.1.2.1: com client_id ou redirect_uri invalidos o
    // servidor NAO pode redirecionar, sob pena de virar open redirect.
    if (!project) {
      throw new OAuthException('invalid_request', 'client_id desconhecido');
    }

    // A autorizacao para usar o SSO nasce dentro do SSO. Existir no cadastro
    // nao basta: enquanto o projeto nao for ativado por um administrador, ou
    // depois de suspenso, ele nao inicia fluxo nenhum. Tambem nao redireciona,
    // pela mesma razao do caso acima.
    if (project.status !== ProjectStatus.ACTIVE) {
      this.logger.warn(
        `authorize recusado: projeto ${project.name} esta ${project.status}`,
      );

      throw new OAuthException(
        'unauthorized_client',
        'este cliente nao esta autorizado a usar o SSO',
      );
    }

    // Comparacao de string exata, exigida pela RFC 9700 secao 2.1.
    const allowed = project.redirectUris.some(
      (r) => r.redirectUri === query.redirect_uri,
    );

    if (!allowed) {
      throw new OAuthException(
        'invalid_request',
        'redirect_uri nao registrada para este client_id',
      );
    }

    // A partir daqui a redirect_uri e confiavel e todo erro volta por ela.
    const fail = (error: OAuthErrorCode, description: string) =>
      new AuthorizeRedirectException(
        query.redirect_uri,
        error,
        description,
        query.state,
      );

    if (!query.state) {
      throw fail('invalid_request', 'state e obrigatorio');
    }

    if (query.response_type !== 'code') {
      throw fail('unsupported_response_type', 'response_type deve ser "code"');
    }

    if (query.code_challenge_method !== 'S256') {
      throw fail(
        'invalid_request',
        'code_challenge_method deve ser S256; plain nao e aceito',
      );
    }

    if (!query.code_challenge || !PKCE_PATTERN.test(query.code_challenge)) {
      throw fail(
        'invalid_request',
        'code_challenge deve ter de 43 a 128 caracteres do conjunto unreserved',
      );
    }

    const transaction: PkceTransaction = {
      kind: 'authorize',
      projectId: project.id,
      clientId: project.clientId,
      projectName: project.name,
      redirectUri: query.redirect_uri,
      codeChallenge: query.code_challenge,
      codeChallengeMethod: 'S256',
      state: query.state,
      googleNonce: this.randomToken(16),
      createdAt: Math.floor(Date.now() / 1000),
    };

    const session = await this.currentSession(req, res);

    // Sessao viva: este e o "single" do single sign-on. Sem ela, todo
    // /authorize refaria a federacao com o Google.
    if (session) {
      await this.authSessions.touch(session.id);
      await this.issueCodeAndRedirect(
        res,
        session.id,
        session.userId,
        transaction,
      );
      return;
    }

    this.storeTransaction(res, transaction);

    // A pessoa vai a tela de login do front, e nao direto ao Google. E ela
    // que diz em qual aplicacao a pessoa esta entrando e oferece os provedores.
    res.redirect(this.loginPage.url());
  }

  /**
   * Login do console do proprio SSO.
   *
   * Mesma ordem de validacao do authorize: `redirect_uri` exata na lista do
   * projeto `SSO` antes de qualquer redirect, e so depois o resto, com o erro
   * voltando por ela. A diferenca e a volta: sem code, so o `state`. O console
   * se autentica pela sessao do SSO, na mesma origem da API (RFC 10017 secao
   * 7.1), entao nao ha token a trocar.
   */
  async beginSessionLogin(
    query: SessionLogin,
    req: Request,
    res: Response,
  ): Promise<void> {
    const project = await this.prisma.project.findUnique({
      where: { name: SSO_SELF_PROJECT_NAME },
      include: { redirectUris: { select: { redirectUri: true } } },
    });

    if (!project) {
      throw new OAuthException(
        'invalid_request',
        'o projeto do proprio SSO nao existe; rode o SQL de primeira subida do ambiente',
      );
    }

    if (project.status !== ProjectStatus.ACTIVE) {
      throw new OAuthException(
        'unauthorized_client',
        'o console do SSO nao esta ativo',
      );
    }

    const allowed = project.redirectUris.some(
      (r) => r.redirectUri === query.redirect_uri,
    );

    if (!allowed) {
      throw new OAuthException(
        'invalid_request',
        'redirect_uri nao registrada para o console do SSO',
      );
    }

    if (!query.state || !STATE_PATTERN.test(query.state)) {
      throw new AuthorizeRedirectException(
        query.redirect_uri,
        'invalid_request',
        'state deve ter de 16 a 256 caracteres do conjunto unreserved',
        query.state,
      );
    }

    const transaction: SessionTransaction = {
      kind: 'session',
      projectId: project.id,
      projectName: project.name,
      redirectUri: query.redirect_uri,
      state: query.state,
      googleNonce: this.randomToken(16),
      createdAt: Math.floor(Date.now() / 1000),
    };

    const session = await this.currentSession(req, res);

    if (session) {
      await this.authSessions.touch(session.id);
      await this.finishSessionLogin(res, session.userId, transaction);
      return;
    }

    this.storeTransaction(res, transaction);
    res.redirect(this.loginPage.url());
  }

  async completeGoogleLogin(
    req: Request,
    res: Response,
    googleUser: GoogleUser,
  ): Promise<void> {
    const transaction = this.cookies.get<LoginTransaction>(req, SSO_TX_COOKIE);

    this.cookies.clear(res, SSO_TX_COOKIE, { sameSite: 'lax' });

    // O guard ja barra quem chega sem transacao. Isto cobre a corrida em que
    // o cookie expira entre o guard e aqui.
    if (!transaction) {
      throw new LoginPageRedirectException('request_expired');
    }

    // O maxAge do cookie ja limita, mas o relogio do cliente nao e confiavel.
    const age = Math.floor(Date.now() / 1000) - transaction.createdAt;

    if (age > TX_COOKIE_TTL_SECONDS) {
      throw new LoginPageRedirectException('request_expired');
    }

    // Fecha o CSRF no trecho SSO -> Google: o `state` que o provedor devolve
    // tem de ser o nonce que guardamos no cookie desta transacao.
    const returnedNonce = (req.query as Record<string, unknown>)?.state;

    if (
      typeof returnedNonce !== 'string' ||
      !this.timingSafeEqual(returnedNonce, transaction.googleNonce)
    ) {
      this.logger.warn(
        'state do provedor nao confere com o nonce da transacao',
      );

      // Nenhuma sessao e criada. Para a pessoa a mensagem e "recomece pela
      // aplicacao": o caso comum aqui e uma aba antiga, nao um ataque.
      throw new LoginPageRedirectException('request_expired');
    }

    const session = await this.authSessions.create(googleUser.userId);

    this.cookies.set(
      res,
      SSO_SESSION_COOKIE,
      {
        authSessionId: session.id,
        csrf: this.randomToken(32),
      } satisfies SsoSessionCookie,
      this.authSessions.maxAgeSeconds,
    );

    if (transaction.kind === 'session') {
      await this.finishSessionLogin(res, googleUser.userId, transaction);
      return;
    }

    await this.issueCodeAndRedirect(
      res,
      session.id,
      googleUser.userId,
      transaction,
    );
  }

  /**
   * O pedido que a tela de login esta atendendo.
   *
   * 404 quando nao ha pedido: a tela nao oferece provedor nenhum e explica que
   * precisa ser aberta por uma aplicacao. Nada sensivel sai daqui, so o nome
   * da aplicacao e o endereco que inicia a federacao.
   */
  pendingRequest(req: Request): LoginRequestView {
    const transaction = this.cookies.get<LoginTransaction>(req, SSO_TX_COOKIE);
    const now = Math.floor(Date.now() / 1000);

    if (!transaction || now - transaction.createdAt > TX_COOKIE_TTL_SECONDS) {
      throw new NotFoundException({
        error: 'no_pending_request',
        message: 'nenhum pedido de login pendente neste navegador',
      });
    }

    return {
      kind: transaction.kind ?? 'authorize',
      application: transaction.projectName ?? null,
      expiresAt: new Date(
        (transaction.createdAt + TX_COOKIE_TTL_SECONDS) * 1000,
      ).toISOString(),
      providers: [
        { id: 'google', label: 'Google', url: `${this.issuer}/oauth/google` },
      ],
    };
  }

  // ------------------------------------------------------------------ //
  // Token endpoint
  // ------------------------------------------------------------------ //

  async exchangeToken(body: Token): Promise<TokenResponse> {
    const project = await this.clientAuth.authenticate(body);

    return body.grant_type === 'authorization_code'
      ? this.grantAuthorizationCode(body, project)
      : this.grantRefreshToken(body, project);
  }

  private async grantAuthorizationCode(
    body: Token,
    project: Project,
  ): Promise<TokenResponse> {
    if (!body.code) {
      throw new OAuthException('invalid_request', 'code e obrigatorio');
    }

    if (!body.code_verifier) {
      throw new OAuthException(
        'invalid_request',
        'code_verifier e obrigatorio',
      );
    }

    if (!body.redirect_uri) {
      throw new OAuthException('invalid_request', 'redirect_uri e obrigatorio');
    }

    const consumed = await this.codes.consume(body.code);

    if (consumed.projectId !== project.id) {
      throw new OAuthException(
        'invalid_grant',
        'authorization code emitido para outro cliente',
      );
    }

    if (consumed.redirectUri !== body.redirect_uri) {
      throw new OAuthException(
        'invalid_grant',
        'redirect_uri diferente da usada na autorizacao',
      );
    }

    /* A redirect_uri pode ter saido do projeto depois de o code ser emitido,
     * inclusive por um login que ainda estava no Google. Apagar o endereco o
     * tira de circulacao na hora: code emitido para ele nao vira token. */
    const stillRegistered = await this.prisma.redirectUri.findUnique({
      where: {
        projectId_redirectUri: {
          projectId: consumed.projectId,
          redirectUri: consumed.redirectUri,
        },
      },
      select: { id: true },
    });

    if (!stillRegistered) {
      throw new OAuthException(
        'invalid_grant',
        'redirect_uri nao esta mais registrada no projeto',
      );
    }

    if (
      !this.codes.verifyChallenge(body.code_verifier, consumed.codeChallenge)
    ) {
      throw new OAuthException('invalid_grant', 'verificacao PKCE falhou');
    }

    const refreshToken = await this.refreshTokens.issue({
      userId: consumed.userId,
      projectId: consumed.projectId,
      authSessionId: consumed.authSessionId,
    });

    return this.buildTokenResponse(
      consumed.userId,
      consumed.projectId,
      project.clientId,
      refreshToken,
      consumed.authSessionId,
    );
  }

  private async grantRefreshToken(
    body: Token,
    project: Project,
  ): Promise<TokenResponse> {
    if (!body.refresh_token) {
      throw new OAuthException(
        'invalid_request',
        'refresh_token e obrigatorio',
      );
    }

    const rotated = await this.refreshTokens.rotate(
      body.refresh_token,
      project.id,
    );

    return this.buildTokenResponse(
      rotated.userId,
      rotated.projectId,
      project.clientId,
      rotated.token,
      rotated.authSessionId,
    );
  }

  /**
   * Monta o par de tokens. As permissoes sao lidas do banco a cada emissao,
   * entao mudanca de papel passa a valer no proximo access token, que dura
   * minutos, e nao mais no proximo login, que durava quinze dias.
   */
  private async buildTokenResponse(
    userId: string,
    projectId: string,
    clientId: string,
    refreshToken: string,
    authSessionId: string,
  ): Promise<TokenResponse> {
    const projectUser = await this.prisma.projectUser.findUnique({
      where: { userId_projectId: { userId, projectId } },
      include: {
        user: { select: { email: true, name: true } },
        role: { select: { name: true } },
      },
    });

    if (!projectUser) {
      throw new OAuthException(
        'invalid_grant',
        'usuario nao tem papel neste projeto',
      );
    }

    // O token leva o PAPEL, nao a lista de rotas. A aplicacao resolve uma
    // coisa na outra e cacheia pelo hash.
    const { hash } = await this.permissionSets.forRole(
      projectId,
      projectUser.role.name,
    );

    const access = await this.tokenIssuer.issue({
      userId,
      clientId,
      email: projectUser.user.email,
      name: projectUser.user.name,
      role: projectUser.role.name,
      permissionHash: hash,
      authSessionId,
    });

    return {
      access_token: access.token,
      token_type: 'Bearer',
      expires_in: access.expiresIn,
      refresh_token: refreshToken,
    };
  }

  /**
   * Revogacao (RFC 7009).
   *
   * A secao 2 pede `MUST` para refresh token e `SHOULD` para access token, e a
   * secao 2.1 manda, ao revogar um refresh token, invalidar tambem o que saiu
   * do mesmo grant. Aqui os dois tipos sao aceitos e os dois derrubam a MESMA
   * coisa: a familia de refresh tokens daquela sessao, naquele projeto. Depois
   * disso a sessao nao renova mais, e e isso que encerra o acesso de verdade.
   *
   * O `token_type_hint` e otimizacao, nao instrucao. A secao 2.1 diz que, se o
   * servidor nao achar o token pela dica, ele tem de procurar nos outros tipos.
   * E o que o laco abaixo faz.
   *
   * ⚠️ **O access token ja emitido continua verificando ate expirar.** Ele e
   * assinado e conferido sem consulta ao servidor, que e justamente o que torna
   * a arquitetura barata: o RP nao fala com o SSO a cada requisicao. A RFC
   * 10017 secao 6.2.4 reconhece esse limite. Derruba-lo de fato exigiria o RP
   * consultar uma lista de revogados a cada chamada, e o preco disso e a
   * propriedade que se quis preservar. A mitigacao e o token ser curto: 15
   * minutos por padrao, e e por isso que esse numero nao deve crescer.
   */
  async revokeToken(body: Revoke): Promise<void> {
    const project = await this.clientAuth.authenticate(body);

    const ordem: ('refresh' | 'access')[] =
      body.token_type_hint === 'access_token'
        ? ['access', 'refresh']
        : ['refresh', 'access'];

    for (const tipo of ordem) {
      if (tipo === 'refresh') {
        const revogado = await this.refreshTokens.revokeByToken(
          body.token,
          project.id,
        );

        if (revogado) {
          this.logger.log(`refresh token revogado a pedido de ${project.name}`);
          return;
        }

        continue;
      }

      const authSessionId = await this.sessionFromAccessToken(
        body.token,
        project.clientId,
      );

      if (authSessionId) {
        const derrubados = await this.refreshTokens.revokeForSessionAndProject(
          authSessionId,
          project.id,
        );

        this.logger.log(
          `access token revogado a pedido de ${project.name}: ${derrubados} refresh token(s) da mesma sessao`,
        );

        return;
      }
    }

    // Nao vaza se o token existia: a RFC 7009 secao 2.2 manda responder 200
    // tambem para token desconhecido, senao o endpoint vira oraculo.
  }

  /**
   * Le o `sid` de um access token que este servidor emitiu para este cliente.
   *
   * Devolve null para qualquer coisa que nao seja isso, sem distinguir o
   * motivo: quem chama responde 200 de todo jeito.
   *
   * A validade NAO e conferida de proposito. Revogar a partir de um token ja
   * expirado e o caso comum: a pessoa ficou parada e clicou em sair. Recusar
   * ali deixaria a familia de refresh tokens viva, que e o oposto do pedido.
   */
  private async sessionFromAccessToken(
    token: string,
    clientId: string,
  ): Promise<string | null> {
    return (await this.accessTokenClaims(token, clientId))?.sid ?? null;
  }

  /**
   * As claims de um access token que este servidor emitiu para este cliente,
   * com a assinatura conferida. `null` para qualquer outra coisa.
   *
   * Nao olha `exp`: cada chamador decide. O revoke aceita token vencido, e a
   * introspeccao nao.
   */
  private async accessTokenClaims(
    token: string,
    clientId: string,
  ): Promise<{
    iss: string;
    aud: string;
    sub: string;
    sid: string;
    jti?: string;
    exp?: number;
    iat?: number;
  } | null> {
    const partes = token.split('.');

    if (partes.length !== 3) return null;

    const [cabecalho, corpo, assinatura] = partes;

    const decodificar = <T>(parte: string): T | null => {
      try {
        return JSON.parse(
          Buffer.from(parte, 'base64url').toString('utf8'),
        ) as T;
      } catch {
        return null;
      }
    };

    const header = decodificar<{ alg?: string; kid?: string }>(cabecalho);

    // Allowlist fechada de algoritmo, como em toda verificacao deste servidor.
    if (!header || header.alg !== 'RS256' || !header.kid) return null;

    const publicKeyPem = await this.signingKeys.publicKeyFor(header.kid);

    if (!publicKeyPem) return null;

    const confere = crypto.verify(
      'sha256',
      Buffer.from(`${cabecalho}.${corpo}`),
      crypto.createPublicKey(publicKeyPem),
      Buffer.from(assinatura, 'base64url'),
    );

    if (!confere) return null;

    const claims = decodificar<{
      iss?: string;
      aud?: string;
      sub?: string;
      sid?: string;
      jti?: string;
      exp?: number;
      iat?: number;
    }>(corpo);

    if (!claims?.sid || !claims.sub) return null;
    if (claims.iss !== this.issuer) return null;

    // Um cliente nao derruba nem consulta a sessao de outro apresentando um
    // token capturado.
    if (claims.aud !== clientId) return null;

    return {
      iss: claims.iss,
      aud: claims.aud,
      sub: claims.sub,
      sid: claims.sid,
      jti: claims.jti,
      exp: claims.exp,
      iat: claims.iat,
    };
  }

  /**
   * Introspeccao (RFC 7662): o token ainda vale, e qual e o papel da pessoa
   * agora?
   *
   * O access token e assinado e verificado sem consulta, e por isso continuava
   * valendo ate expirar depois de o SSO mudar de ideia sobre ele: papel
   * trocado, pessoa tirada do projeto, aplicacao suspensa, logout. Este endpoint
   * e a consulta que fecha essa janela. A aplicacao pergunta de tempos em tempos
   * e, quando o papel mudou, pede um token novo na hora.
   *
   * Ativo exige tudo isto, e qualquer falta responde so `{ active: false }`:
   *
   * - assinatura, `iss` e `aud` deste cliente, e `exp` no futuro;
   * - a sessao do SSO (`sid`) viva e da mesma pessoa;
   * - a pessoa ainda com papel no projeto;
   * - um refresh token vivo no mesmo grant. Logout e revogacao (RFC 7009)
   *   derrubam a familia, e a secao 2.1 daquela RFC manda o access token do
   *   mesmo grant cair junto: e aqui que isso passa a valer de verdade;
   * - o projeto ativo, que `authenticate` ja confere.
   *
   * Token de outro cliente responde inativo, e nao erro: a RFC 7662 secao 4
   * nao quer o endpoint dizendo que o token existe.
   */
  async introspect(body: Introspect): Promise<IntrospectionResponse> {
    const project = await this.clientAuth.authenticate(body);
    const inativo: IntrospectionResponse = { active: false };

    const claims = await this.accessTokenClaims(body.token, project.clientId);

    if (!claims) return inativo;

    const agora = Math.floor(Date.now() / 1000);

    if (typeof claims.exp !== 'number' || claims.exp <= agora) return inativo;

    const sessao = await this.authSessions.findValid(claims.sid);

    if (!sessao || sessao.userId !== claims.sub) return inativo;

    const vinculo = await this.prisma.projectUser.findUnique({
      where: { userId_projectId: { userId: claims.sub, projectId: project.id } },
      include: { role: { select: { name: true } } },
    });

    if (!vinculo) return inativo;

    const grantVivo = await this.prisma.refreshToken.findFirst({
      where: {
        userId: claims.sub,
        projectId: project.id,
        authSessionId: claims.sid,
        revokedAt: null,
        consumedAt: null,
        expiresAt: { gt: new Date() },
      },
      select: { id: true },
    });

    if (!grantVivo) return inativo;

    const { hash } = await this.permissionSets.forRole(
      project.id,
      vinculo.role.name,
    );

    return {
      active: true,
      client_id: project.clientId,
      token_type: 'Bearer',
      sub: claims.sub,
      aud: claims.aud,
      iss: claims.iss,
      jti: claims.jti,
      exp: claims.exp,
      iat: claims.iat,
      sid: claims.sid,
      roles: [vinculo.role.name],
      perm: hash,
    };
  }
  /**
   * Resolve um papel no conjunto de rotas que ele libera.
   *
   * A aplicacao cliente chama uma vez por papel, guiada pela claim `roles` do
   * token, e cacheia pelo `hash`. E o outro lado do token magro.
   */
  async resolvePermissions(body: ResolvePermissions): Promise<PermissionSet> {
    const project = await this.clientAuth.authenticate(body);

    return this.permissionSets.forRole(project.id, body.role);
  }

  // ------------------------------------------------------------------ //
  // Sessao
  // ------------------------------------------------------------------ //

  async logout(req: Request, res: Response): Promise<void> {
    const cookie = this.cookies.get<SsoSessionCookie>(req, SSO_SESSION_COOKIE);

    if (cookie?.authSessionId) {
      // Encerrar a sessao derruba os refresh tokens de todos os projetos.
      await this.refreshTokens.revokeForSession(cookie.authSessionId);
      await this.authSessions.revoke(cookie.authSessionId);
    }

    this.cookies.clear(res, SSO_SESSION_COOKIE);
    this.cookies.clear(res, SSO_TX_COOKIE, { sameSite: 'lax' });
  }

  /**
   * Estado da sessao deste navegador.
   *
   * Nao exige papel em projeto nenhum: quem entrou mas nao tem acesso ao
   * console ainda precisa do token anti-CSRF para conseguir sair. Sessao antiga,
   * sem token, ganha um aqui, com o prazo que ainda resta a ela.
   */
  async describeSession(req: Request, res: Response): Promise<SessionView> {
    const cookie = this.cookies.get<SsoSessionCookie>(req, SSO_SESSION_COOKIE);

    if (!cookie?.authSessionId) return { active: false };

    const session = await this.prisma.authSession.findUnique({
      where: { id: cookie.authSessionId },
      include: { user: { select: { name: true, email: true } } },
    });

    if (
      !session ||
      session.revokedAt ||
      session.expiresAt.getTime() <= Date.now()
    ) {
      this.cookies.clear(res, SSO_SESSION_COOKIE);
      return { active: false };
    }

    let csrfToken = cookie.csrf;

    if (!csrfToken) {
      csrfToken = this.randomToken(32);

      const remainingSeconds = Math.max(
        1,
        Math.floor((session.expiresAt.getTime() - Date.now()) / 1000),
      );

      this.cookies.set(
        res,
        SSO_SESSION_COOKIE,
        {
          authSessionId: session.id,
          csrf: csrfToken,
        } satisfies SsoSessionCookie,
        remainingSeconds,
      );
    }

    return {
      active: true,
      user: { name: session.user.name, email: session.user.email },
      csrfToken,
    };
  }

  /**
   * Logout do console. E escrita autenticada por cookie, entao exige o token
   * anti-CSRF: sem ele, qualquer site poderia derrubar a sessao de quem o
   * visitasse. Sem sessao, nao ha o que encerrar e a resposta e a mesma.
   */
  async endSession(req: Request, res: Response): Promise<void> {
    const cookie = this.cookies.get<SsoSessionCookie>(req, SSO_SESSION_COOKIE);

    if (!cookie?.authSessionId) {
      this.cookies.clear(res, SSO_SESSION_COOKIE);
      return;
    }

    const header = req.headers[SSO_CSRF_HEADER];

    if (
      !cookie.csrf ||
      typeof header !== 'string' ||
      !this.timingSafeEqual(header, cookie.csrf)
    ) {
      throw new ForbiddenException({
        error: 'csrf_token_invalid',
        message: 'encerrar a sessao exige o header X-CSRF-Token',
      });
    }

    await this.logout(req, res);
  }

  private timingSafeEqual(a: string, b: string): boolean {
    const left = Buffer.from(a);
    const right = Buffer.from(b);

    return left.length === right.length && crypto.timingSafeEqual(left, right);
  }

  private randomToken(bytes: number): string {
    return crypto.randomBytes(bytes).toString('base64url');
  }

  /**
   * O retorno do Google e uma navegacao cross-site, e SameSite=Strict nao
   * acompanharia esse salto: o callback chegaria sem transacao. Por isso o
   * cookie de transacao e sempre lax, qualquer que seja a configuracao.
   */
  private storeTransaction(res: Response, transaction: LoginTransaction): void {
    this.cookies.set(res, SSO_TX_COOKIE, transaction, TX_COOKIE_TTL_SECONDS, {
      sameSite: 'lax',
    });
  }

  private async currentSession(req: Request, res: Response) {
    const cookie = this.cookies.get<SsoSessionCookie>(req, SSO_SESSION_COOKIE);

    if (!cookie?.authSessionId) return null;

    const session = await this.authSessions.findValid(cookie.authSessionId);

    if (!session) {
      this.cookies.clear(res, SSO_SESSION_COOKIE);
      return null;
    }

    return session;
  }

  /**
   * Volta ao console. Quem nao tem papel no projeto `SSO` volta com
   * `access_denied`, como no authorize: a sessao existe, mas nao abre o console.
   */
  private async finishSessionLogin(
    res: Response,
    userId: string,
    transaction: SessionTransaction,
  ): Promise<void> {
    const membership = await this.prisma.projectUser.findUnique({
      where: {
        userId_projectId: { userId, projectId: transaction.projectId },
      },
    });

    const target = new URL(transaction.redirectUri);

    if (!membership) {
      target.searchParams.set('error', 'access_denied');
      target.searchParams.set(
        'error_description',
        'usuario sem papel no console do SSO',
      );
    }

    target.searchParams.set('state', transaction.state);
    target.searchParams.set('iss', this.issuer);

    res.redirect(target.toString());
  }

  private async issueCodeAndRedirect(
    res: Response,
    authSessionId: string,
    userId: string,
    transaction: PkceTransaction,
  ): Promise<void> {
    const membership = await this.prisma.projectUser.findUnique({
      where: {
        userId_projectId: { userId, projectId: transaction.projectId },
      },
    });

    if (!membership) {
      throw new AuthorizeRedirectException(
        transaction.redirectUri,
        'access_denied',
        'usuario nao tem acesso a este projeto',
        transaction.state,
      );
    }

    const code = await this.codes.issue({
      userId,
      projectId: transaction.projectId,
      authSessionId,
      redirectUri: transaction.redirectUri,
      codeChallenge: transaction.codeChallenge,
      codeChallengeMethod: transaction.codeChallengeMethod,
    });

    const target = new URL(transaction.redirectUri);

    target.searchParams.set('code', code);
    target.searchParams.set('state', transaction.state);
    // RFC 9207: diz ao cliente qual AS respondeu. E a defesa contra mix-up
    // recomendada pela RFC 9700 secao 2.1 para quem fala com mais de um AS.
    target.searchParams.set('iss', this.issuer);

    this.logger.log(
      `authorization code emitido para o projeto ${transaction.clientId.slice(0, 8)}...`,
    );

    res.redirect(target.toString());
  }
}
