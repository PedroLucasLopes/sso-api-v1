import { ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request, Response } from 'express';
import * as crypto from 'node:crypto';
import { AuthSession } from 'generated/prisma/client';
import { SSO_SELF_PROJECT_NAME } from 'src/global/constants/selfProject.constant';
import { CookieService } from 'src/global/cookie/cookie.service';
import { ApiException } from 'src/global/error/apiError';
import { MailerService } from 'src/global/mail/mailer.service';
import { PrismaService } from 'src/global/prisma/prisma.service';
import {
  ACCOUNT_MFA_COOKIE,
  ACCOUNT_MFA_TTL_SECONDS,
} from '../account.constant';
import { SSO_CSRF_HEADER, SSO_SESSION_COOKIE } from '../auth.constant';
import {
  AccountMfaConfirmView,
  AccountMfaPending,
  AccountMfaSetup,
  AccountMfaSetupView,
  AccountProfileView,
} from '../dto/account.dto';
import { MfaCode } from '../dto/loginStep.dto';
import { SsoSessionCookie } from '../dto/pkceTransaction.dto';
import { AuthSessionService } from './authSession.service';
import { CredentialService } from './credential.service';

export interface AccountSession {
  session: AuthSession;
  csrf: string;
}

@Injectable()
export class AccountProfileService {
  private readonly logger = new Logger(AccountProfileService.name);
  private readonly issuerName: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly cookies: CookieService,
    private readonly authSessions: AuthSessionService,
    private readonly credentials: CredentialService,
    private readonly mailer: MailerService,
    config: ConfigService,
  ) {
    this.issuerName = new URL(config.getOrThrow<string>('SSO_ISSUER')).host;
  }

  async describe(req: Request, res: Response): Promise<AccountProfileView> {
    const { session, csrf } = await this.open(req, res);

    const user = await this.prisma.user.findUnique({
      where: { id: session.userId },
      select: {
        name: true,
        email: true,
        authId: true,
        password: { select: { userId: true } },
        projectUsers: {
          select: { project: { select: { name: true, displayName: true } } },
        },
      },
    });

    if (!user) return this.endedSession(res);

    const mfa = await this.credentials.mfaStatus(session.userId);
    const admin = user.projectUsers.some(
      (membership) => membership.project.name === SSO_SELF_PROJECT_NAME,
    );

    return {
      name: user.name,
      email: user.email,
      password: !!user.password,
      google: !!user.authId,
      applications: user.projectUsers
        .filter(
          (membership) => membership.project.name !== SSO_SELF_PROJECT_NAME,
        )
        .map(
          (membership) =>
            membership.project.displayName ?? membership.project.name,
        )
        .sort((a, b) => a.localeCompare(b)),
      secondFactor: {
        enrolled: mfa.enrolled,
        recoveryCodesLeft: mfa.recoveryCodesLeft,
      },
      deletion: {
        allowed: !admin && this.mailer.available,
        reason: admin
          ? 'admin'
          : this.mailer.available
            ? null
            : 'email_unavailable',
      },
      csrfToken: csrf,
    };
  }

  async startMfaEnrollment(
    req: Request,
    res: Response,
    body: AccountMfaSetup,
  ): Promise<AccountMfaSetupView> {
    const { session } = await this.requireWriter(req, res);

    const user = await this.prisma.user.findUnique({
      where: { id: session.userId },
      select: { email: true, password: { select: { userId: true } } },
    });

    if (!user) return this.endedSession(res);

    if ((await this.credentials.mfaStatus(session.userId)).enrolled) {
      throw new ApiException('mfa_already_enrolled');
    }

    if (user.password) {
      const check = await this.credentials.checkPassword(
        user.email,
        body.password ?? '',
      );

      if (!check.ok) {
        throw new ApiException(
          check.reason === 'locked'
            ? 'account_locked'
            : 'current_password_invalid',
        );
      }
    }

    const enrollment = this.credentials.startMfaEnrollment(
      user.email,
      this.issuerName,
    );

    this.cookies.set(
      res,
      ACCOUNT_MFA_COOKIE,
      {
        userId: session.userId,
        sessionId: session.id,
        secret: enrollment.secret,
        createdAt: Math.floor(Date.now() / 1000),
      } satisfies AccountMfaPending,
      ACCOUNT_MFA_TTL_SECONDS,
      { sameSite: 'strict' },
    );

    return { secret: enrollment.secret, otpauth: enrollment.otpauth };
  }

  async confirmMfaEnrollment(
    req: Request,
    res: Response,
    body: MfaCode,
  ): Promise<AccountMfaConfirmView> {
    const { session } = await this.requireWriter(req, res);
    const pending = this.cookies.get<AccountMfaPending>(
      req,
      ACCOUNT_MFA_COOKIE,
    );
    const age = pending
      ? Math.floor(Date.now() / 1000) - pending.createdAt
      : Number.POSITIVE_INFINITY;

    if (
      !pending ||
      pending.userId !== session.userId ||
      pending.sessionId !== session.id ||
      age > ACCOUNT_MFA_TTL_SECONDS
    ) {
      throw new ApiException('mfa_setup_expired');
    }

    if ((await this.credentials.mfaStatus(session.userId)).enrolled) {
      this.clearPending(res);
      throw new ApiException('mfa_already_enrolled');
    }

    const recoveryCodes = await this.credentials.confirmMfaEnrollment(
      session.userId,
      pending.secret,
      body.code,
    );

    this.clearPending(res);
    await this.authSessions.promote(session.id, session.userId);

    this.logger.log(
      `segundo fator cadastrado pela pagina da conta: ${session.userId}`,
    );

    return { recoveryCodes };
  }

  async requireWriter(req: Request, res: Response): Promise<AccountSession> {
    const cookie = this.cookies.get<SsoSessionCookie>(req, SSO_SESSION_COOKIE);
    const session = cookie?.authSessionId
      ? await this.authSessions.findValid(cookie.authSessionId)
      : null;

    if (!session) return this.endedSession(res);

    const header = req.headers[SSO_CSRF_HEADER];

    if (
      !cookie?.csrf ||
      typeof header !== 'string' ||
      !this.sameToken(header, cookie.csrf)
    ) {
      throw new ForbiddenException({
        error: 'csrf_token_invalid',
        message: 'esta acao da conta exige o header X-CSRF-Token',
      });
    }

    return { session, csrf: cookie.csrf };
  }

  clearPending(res: Response): void {
    this.cookies.clear(res, ACCOUNT_MFA_COOKIE, { sameSite: 'strict' });
  }

  private async open(req: Request, res: Response): Promise<AccountSession> {
    const cookie = this.cookies.get<SsoSessionCookie>(req, SSO_SESSION_COOKIE);
    const session = cookie?.authSessionId
      ? await this.authSessions.findValid(cookie.authSessionId)
      : null;

    if (!cookie || !session) return this.endedSession(res);

    if (cookie.csrf) return { session, csrf: cookie.csrf };

    const csrf = crypto.randomBytes(32).toString('base64url');
    const remainingSeconds = Math.max(
      1,
      Math.floor((session.expiresAt.getTime() - Date.now()) / 1000),
    );

    this.cookies.set(
      res,
      SSO_SESSION_COOKIE,
      { authSessionId: session.id, csrf } satisfies SsoSessionCookie,
      remainingSeconds,
    );

    return { session, csrf };
  }

  private endedSession(res: Response): never {
    this.cookies.clear(res, SSO_SESSION_COOKIE);

    throw new ApiException('login_required');
  }

  private sameToken(a: string, b: string): boolean {
    const left = Buffer.from(a);
    const right = Buffer.from(b);

    return left.length === right.length && crypto.timingSafeEqual(left, right);
  }
}
