import {
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  OnApplicationBootstrap,
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
import { ApiException } from '../error/apiError';

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

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

@Injectable()
export class AdminAccessService implements OnApplicationBootstrap {
  private readonly logger = new Logger(AdminAccessService.name);
  private readonly issuer: string;
  private readonly prefix = `/${SSO_ROUTE_PREFIX}`;

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

    const missing: string[] = [];

    if (!project) {
      missing.push(`o projeto "${SSO_SELF_PROJECT_NAME}"`);
    } else {
      if (project.status !== ProjectStatus.ACTIVE) {
        missing.push(`o projeto "${SSO_SELF_PROJECT_NAME}" ativo`);
      }

      if (project.projectUsers.length === 0) {
        missing.push(`um usuario com o papel ${SSO_ROOT_ROLE}`);
      }

      if (project._count.redirectUris === 0) {
        missing.push('uma redirect URI para o console');
      }
    }

    if (missing.length > 0) {
      throw new Error(
        `o SSO nao sobe sem ${missing.join(', ')}. ` +
          'Rode o SQL de primeira subida deste ambiente.',
      );
    }
  }

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

      throw new ApiException('sso_access_denied');
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
        message: 'a origem do pedido nao pertence ao console do SSO',
      });
    }
  }

  async authorize(request: Request, identity: AdminIdentity): Promise<void> {
    if (identity.root) return;

    if (await this.reaches(identity, request.method, request.path)) return;

    this.logger.warn(
      `negado: ${identity.email} (${identity.role}) em ${request.method} ${this.normalize(request.path)}`,
    );

    throw this.notFound(request);
  }

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

  forgetSelfProject(): void {
    this.selfProject = null;
  }

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

  private async fromSession(
    request: Request,
    response?: Response,
  ): Promise<Credential> {
    const cookie = this.cookies.get<SsoSessionCookie>(
      request,
      SSO_SESSION_COOKIE,
    );

    if (!cookie?.authSessionId) {
      throw new ApiException('login_required');
    }

    const session = await this.prisma.authSession.findUnique({
      where: { id: cookie.authSessionId },
    });

    if (
      !session ||
      session.revokedAt ||
      session.expiresAt.getTime() <= Date.now()
    ) {
      throw new ApiException('login_required');
    }

    let csrfToken = cookie.csrf;

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

  private invalidToken(reason: string): ApiException {
    this.logger.warn(`access token recusado: ${reason}`);

    return new ApiException('invalid_token');
  }

  private async verifyBearer(request: Request): Promise<AccessTokenClaims> {
    const header = request.headers.authorization;

    if (!header?.startsWith('Bearer ')) {
      throw new ApiException('login_required');
    }

    const token = header.slice('Bearer '.length).trim();
    const parts = token.split('.');

    if (parts.length !== 3) {
      throw this.invalidToken('access token malformado');
    }

    const [encodedHeader, encodedPayload, encodedSignature] = parts;
    const jwtHeader = this.decode<{ alg?: string; kid?: string }>(
      encodedHeader,
    );

    if (!jwtHeader || jwtHeader.alg !== 'RS256' || !jwtHeader.kid) {
      throw this.invalidToken('cabecalho do token invalido');
    }

    const signingKey = await this.prisma.signingKey.findUnique({
      where: { id: jwtHeader.kid },
    });

    if (!signingKey) {
      throw this.invalidToken('kid desconhecido');
    }

    const verified = crypto.verify(
      'sha256',
      Buffer.from(`${encodedHeader}.${encodedPayload}`),
      crypto.createPublicKey(signingKey.publicKeyPem),
      Buffer.from(encodedSignature, 'base64url'),
    );

    if (!verified) {
      throw this.invalidToken('assinatura do token invalida');
    }

    const claims = this.decode<AccessTokenClaims>(encodedPayload);

    if (!claims?.sub || !claims.jti) {
      throw this.invalidToken('token sem sub ou jti');
    }

    if (claims.iss !== this.issuer) {
      throw this.invalidToken('emissor do token nao e este SSO');
    }

    const now = Math.floor(Date.now() / 1000);

    if (typeof claims.exp !== 'number' || claims.exp <= now) {
      throw this.invalidToken('access token expirado');
    }

    if (typeof claims.nbf === 'number' && claims.nbf > now) {
      throw this.invalidToken('access token ainda nao vale');
    }

    const project = await this.resolveSelfProject();
    const audiences = Array.isArray(claims.aud)
      ? claims.aud
      : [claims.aud ?? ''];

    if (!audiences.includes(project.clientId)) {
      throw this.invalidToken('este token foi emitido para outra aplicacao');
    }

    return claims;
  }

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
        continue;
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
      this.logger.error(
        `o projeto "${SSO_SELF_PROJECT_NAME}" nao existe neste banco; ` +
          'rode o SQL de primeira subida do ambiente',
      );
      throw new ApiException('internal_error');
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

  private normalize(path: string): string {
    let normalized = path;

    const prefix = this.prefix;

    if (
      prefix &&
      normalized.startsWith(prefix) &&
      (normalized.length === prefix.length || normalized[prefix.length] === '/')
    ) {
      normalized = normalized.slice(prefix.length);
    }

    normalized = normalized.replace(/\/{2,}/g, '/');

    if (normalized.length > 1) {
      normalized = normalized.replace(/\/+$/, '');
    }

    return normalized.startsWith('/') ? normalized : `/${normalized}`;
  }
}
