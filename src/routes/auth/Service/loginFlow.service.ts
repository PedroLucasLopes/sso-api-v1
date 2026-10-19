import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request, Response } from 'express';
import { CookieService } from 'src/global/cookie/cookie.service';
import { ApiException } from 'src/global/error/apiError';
import { SSO_TX_COOKIE } from '../auth.constant';
import { LoginTransaction } from '../dto/pkceTransaction.dto';
import {
  LoginStepCookie,
  LoginStepView,
  MfaCode,
  NewPassword,
  PasswordLogin,
} from '../dto/loginStep.dto';
import { AuthorizeRedirectException } from '../error/oauth.exception';
import { AuthService, SessionOptions } from './auth.service';
import { CredentialService } from './credential.service';
import { LoginStepService } from './loginStep.service';

@Injectable()
export class LoginFlowService {
  private readonly logger = new Logger(LoginFlowService.name);
  private readonly issuer: string;
  private readonly issuerName: string;

  constructor(
    private readonly auth: AuthService,
    private readonly credentials: CredentialService,
    private readonly steps: LoginStepService,
    private readonly cookies: CookieService,
    config: ConfigService,
  ) {
    this.issuer = config.getOrThrow<string>('SSO_ISSUER').replace(/\/+$/, '');
    this.issuerName = new URL(this.issuer).host;
  }

  async withPassword(
    req: Request,
    res: Response,
    body: PasswordLogin,
  ): Promise<LoginStepView> {
    this.auth.requirePendingTransaction(req);

    const attempt = await this.credentials.checkPassword(
      body.email,
      body.password,
    );

    if (!attempt.ok) {
      this.steps.clear(res);

      throw new ApiException(
        attempt.reason === 'locked' ? 'account_locked' : 'invalid_credentials',
      );
    }

    if (attempt.mustChange) {
      return this.stepView(res, {
        userId: attempt.userId,
        email: attempt.email,
        stage: 'change_password',
      });
    }

    return this.afterFirstFactor(req, res, attempt.userId, attempt.email);
  }

  async changePassword(
    req: Request,
    res: Response,
    body: NewPassword,
  ): Promise<LoginStepView> {
    const step = this.steps.require(req, 'change_password');

    this.auth.requirePendingTransaction(req);

    await this.credentials.replacePassword(step.userId, body.password);

    this.logger.log(`senha trocada no primeiro acesso: ${step.userId}`);

    return this.afterFirstFactor(req, res, step.userId, step.email);
  }

  startMfaEnrollment(req: Request, res: Response): LoginStepView {
    const step = this.steps.require(req, 'enroll_mfa');

    this.auth.requirePendingTransaction(req);

    const enrollment = this.credentials.startMfaEnrollment(
      step.email,
      this.issuerName,
    );

    this.steps.open(res, { ...step, secret: enrollment.secret });

    return {
      next: 'enroll_mfa',
      email: step.email,
      secret: enrollment.secret,
      otpauth: enrollment.otpauth,
    };
  }

  async confirmMfaEnrollment(
    req: Request,
    res: Response,
    body: MfaCode,
  ): Promise<LoginStepView> {
    const step = this.steps.require(req, 'enroll_mfa');
    const transaction = this.auth.requirePendingTransaction(req);

    if (!step.secret) throw new ApiException('login_step_expired');

    const recoveryCodes = await this.credentials.confirmMfaEnrollment(
      step.userId,
      step.secret,
      body.code,
    );

    this.logger.log(`segundo fator cadastrado: ${step.userId}`);

    const done = await this.complete(req, res, step.userId, transaction, {
      singleFactor: false,
      upgradeSessionId: this.upgradable(req, step),
    });

    return { ...done, recoveryCodes };
  }

  async verifyMfa(
    req: Request,
    res: Response,
    body: MfaCode,
  ): Promise<LoginStepView> {
    const step = this.steps.require(req, 'mfa');
    const transaction = this.auth.requirePendingTransaction(req);

    if (!(await this.credentials.verifyMfa(step.userId, body.code))) {
      throw new ApiException('mfa_code_invalid');
    }

    return this.complete(req, res, step.userId, transaction, {
      singleFactor: false,
      upgradeSessionId: this.upgradable(req, step),
    });
  }

  async complete(
    req: Request,
    res: Response,
    userId: string,
    transaction: LoginTransaction,
    options: SessionOptions,
  ): Promise<LoginStepView> {
    this.steps.clear(res);
    this.cookies.clear(res, SSO_TX_COOKIE, { sameSite: 'lax' });

    try {
      return {
        next: 'done',
        redirectTo: await this.auth.completeLogin(res, userId, transaction, {
          ...options,
          replacesSessionId: this.auth.sessionCookieId(req),
        }),
      };
    } catch (error) {
      if (!(error instanceof AuthorizeRedirectException)) throw error;

      return { next: 'done', redirectTo: this.refusedTarget(error) };
    }
  }

  private async afterFirstFactor(
    req: Request,
    res: Response,
    userId: string,
    email: string,
  ): Promise<LoginStepView> {
    const transaction = this.auth.requirePendingTransaction(req);
    const stage = await this.steps.gateFor(userId, transaction.projectId);

    if (!stage) {
      return this.complete(req, res, userId, transaction, {
        singleFactor: true,
      });
    }

    return this.stepView(res, { userId, email, stage });
  }

  private upgradable(req: Request, step: LoginStepCookie): string | undefined {
    if (!step.sessionId) return undefined;

    return this.auth.sessionCookieId(req) === step.sessionId
      ? step.sessionId
      : undefined;
  }

  private stepView(
    res: Response,
    step: Omit<LoginStepCookie, 'createdAt'>,
  ): LoginStepView {
    this.steps.open(res, step);

    return { next: step.stage, email: step.email };
  }

  private refusedTarget(error: AuthorizeRedirectException): string {
    const target = new URL(error.redirectUri);

    target.searchParams.set('error', error.error);
    target.searchParams.set('error_description', error.errorDescription);

    if (error.state) target.searchParams.set('state', error.state);

    target.searchParams.set('iss', this.issuer);

    return target.toString();
  }
}
