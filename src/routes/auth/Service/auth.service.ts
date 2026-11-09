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
import { LoginStepService } from './loginStep.service';
import { RefreshTokenService } from './refreshToken.service';
import { TokenIssuerService } from './tokenIssuer.service';

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
    private steps: LoginStepService,
    config: ConfigService,
  ) {
    this.issuer = config.getOrThrow<string>('SSO_ISSUER').replace(/\/+$/, '');
    this.basePath = new URL(this.issuer).pathname.replace(/\/+$/, '');
  }

  async beginAuthorization(
    query: Authorize,
    req: Request,
    res: Response,
  ): Promise<void> {
    const project = await this.prisma.project.findUnique({
      where: { clientId: query.client_id },
      include: { redirectUris: { select: { redirectUri: true } } },
    });

    if (!project) {
      throw new OAuthException('invalid_request', 'client_id desconhecido');
    }

    if (project.status !== ProjectStatus.ACTIVE) {
      this.logger.warn(
        `authorize recusado: projeto ${project.name} esta ${project.status}`,
      );

      throw new OAuthException(
        'unauthorized_client',
        'este cliente nao esta autorizado a usar o SSO',
      );
    }

    const allowed = project.redirectUris.some(
      (r) => r.redirectUri === query.redirect_uri,
    );

    if (!allowed) {
      throw new OAuthException(
        'invalid_request',
        'redirect_uri nao registrada para este client_id',
      );
    }

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

    res.redirect(this.loginPage.url());
  }

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

    if (!transaction) {
      throw new LoginPageRedirectException('request_expired');
    }

    const age = Math.floor(Date.now() / 1000) - transaction.createdAt;

    if (age > TX_COOKIE_TTL_SECONDS) {
      throw new LoginPageRedirectException('request_expired');
    }

    const returnedNonce = (req.query as Record<string, unknown>)?.state;

    if (
      typeof returnedNonce !== 'string' ||
      !this.timingSafeEqual(returnedNonce, transaction.googleNonce)
    ) {
      this.logger.warn(
        'state do provedor nao confere com o nonce da transacao',
      );

      throw new LoginPageRedirectException('request_expired');
    }

    this.storeTransaction(res, transaction);

    this.steps.open(res, {
      userId: googleUser.userId,
      email: googleUser.email,
      stage: await this.steps.gateFor(googleUser.userId),
    });

    res.redirect(this.loginPage.url());
  }

  pendingRequest(req: Request): LoginRequestView {
    const transaction = this.cookies.get<LoginTransaction>(req, SSO_TX_COOKIE);
    const step = this.steps.read(req);
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
      step: step?.stage ?? 'credentials',
      email: step?.email ?? null,
    };
  }

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

  async revokeToken(body: Revoke): Promise<void> {
    const project = await this.clientAuth.authenticate(body);

    const order: ('refresh' | 'access')[] =
      body.token_type_hint === 'access_token'
        ? ['access', 'refresh']
        : ['refresh', 'access'];

    for (const kind of order) {
      if (kind === 'refresh') {
        const revoked = await this.refreshTokens.revokeByToken(
          body.token,
          project.id,
        );

        if (revoked) {
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
        const dropped = await this.refreshTokens.revokeForSessionAndProject(
          authSessionId,
          project.id,
        );

        this.logger.log(
          `access token revogado a pedido de ${project.name}: ${dropped} refresh token(s) da mesma sessao`,
        );

        return;
      }
    }
  }

  private async sessionFromAccessToken(
    token: string,
    clientId: string,
  ): Promise<string | null> {
    return (await this.accessTokenClaims(token, clientId))?.sid ?? null;
  }

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
    const parts = token.split('.');

    if (parts.length !== 3) return null;

    const [encodedHeader, encodedPayload, encodedSignature] = parts;

    const decode = <T>(part: string): T | null => {
      try {
        return JSON.parse(Buffer.from(part, 'base64url').toString('utf8')) as T;
      } catch {
        return null;
      }
    };

    const header = decode<{ alg?: string; kid?: string }>(encodedHeader);

    if (!header || header.alg !== 'RS256' || !header.kid) return null;

    const publicKeyPem = await this.signingKeys.publicKeyFor(header.kid);

    if (!publicKeyPem) return null;

    const checks = crypto.verify(
      'sha256',
      Buffer.from(`${encodedHeader}.${encodedPayload}`),
      crypto.createPublicKey(publicKeyPem),
      Buffer.from(encodedSignature, 'base64url'),
    );

    if (!checks) return null;

    const claims = decode<{
      iss?: string;
      aud?: string;
      sub?: string;
      sid?: string;
      jti?: string;
      exp?: number;
      iat?: number;
    }>(encodedPayload);

    if (!claims?.sid || !claims.sub) return null;
    if (claims.iss !== this.issuer) return null;

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

  async introspect(body: Introspect): Promise<IntrospectionResponse> {
    const project = await this.clientAuth.authenticate(body);
    const inactive: IntrospectionResponse = { active: false };

    const claims = await this.accessTokenClaims(body.token, project.clientId);

    if (!claims) return inactive;

    const now = Math.floor(Date.now() / 1000);

    if (typeof claims.exp !== 'number' || claims.exp <= now) return inactive;

    const session = await this.authSessions.findValid(claims.sid);

    if (!session || session.userId !== claims.sub) return inactive;

    const membership = await this.prisma.projectUser.findUnique({
      where: {
        userId_projectId: { userId: claims.sub, projectId: project.id },
      },
      include: { role: { select: { name: true } } },
    });

    if (!membership) return inactive;

    const liveGrant = await this.prisma.refreshToken.findFirst({
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

    if (!liveGrant) return inactive;

    const { hash } = await this.permissionSets.forRole(
      project.id,
      membership.role.name,
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
      roles: [membership.role.name],
      perm: hash,
    };
  }
  async resolvePermissions(body: ResolvePermissions): Promise<PermissionSet> {
    const project = await this.clientAuth.authenticate(body);

    return this.permissionSets.forRole(project.id, body.role);
  }

  async logout(req: Request, res: Response): Promise<void> {
    const cookie = this.cookies.get<SsoSessionCookie>(req, SSO_SESSION_COOKIE);

    if (cookie?.authSessionId) {
      await this.refreshTokens.revokeForSession(cookie.authSessionId);
      await this.authSessions.revoke(cookie.authSessionId);
    }

    this.cookies.clear(res, SSO_SESSION_COOKIE);
    this.cookies.clear(res, SSO_TX_COOKIE, { sameSite: 'lax' });
  }

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

  async completeLogin(
    res: Response,
    userId: string,
    transaction: LoginTransaction,
  ): Promise<string> {
    const session = await this.authSessions.create(userId);

    this.cookies.set(
      res,
      SSO_SESSION_COOKIE,
      {
        authSessionId: session.id,
        csrf: this.randomToken(32),
      } satisfies SsoSessionCookie,
      this.authSessions.maxAgeSeconds,
    );

    return transaction.kind === 'session'
      ? this.sessionLoginTarget(userId, transaction)
      : this.codeTarget(session.id, userId, transaction);
  }

  private async finishSessionLogin(
    res: Response,
    userId: string,
    transaction: SessionTransaction,
  ): Promise<void> {
    res.redirect(await this.sessionLoginTarget(userId, transaction));
  }

  private async sessionLoginTarget(
    userId: string,
    transaction: SessionTransaction,
  ): Promise<string> {
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

    return target.toString();
  }

  private async issueCodeAndRedirect(
    res: Response,
    authSessionId: string,
    userId: string,
    transaction: PkceTransaction,
  ): Promise<void> {
    res.redirect(await this.codeTarget(authSessionId, userId, transaction));
  }

  private async codeTarget(
    authSessionId: string,
    userId: string,
    transaction: PkceTransaction,
  ): Promise<string> {
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
    target.searchParams.set('iss', this.issuer);

    this.logger.log(
      `authorization code emitido para o projeto ${transaction.clientId.slice(0, 8)}...`,
    );

    return target.toString();
  }
}
