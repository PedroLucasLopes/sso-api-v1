import { Injectable } from '@nestjs/common';
import { Request, Response } from 'express';
import { CookieService } from 'src/global/cookie/cookie.service';
import { ApiException } from 'src/global/error/apiError';
import { SSO_STEP_COOKIE, STEP_COOKIE_TTL_SECONDS } from '../auth.constant';
import { LoginStage, LoginStepCookie } from '../dto/loginStep.dto';
import { CredentialService } from './credential.service';
import { ProjectEntryService } from './projectEntry.service';

export type SecondFactorStage = Extract<LoginStage, 'enroll_mfa' | 'mfa'>;

@Injectable()
export class LoginStepService {
  constructor(
    private readonly cookies: CookieService,
    private readonly credentials: CredentialService,
    private readonly entries: ProjectEntryService,
  ) {}

  async gateFor(
    userId: string,
    projectId: string,
  ): Promise<SecondFactorStage | null> {
    const mfa = await this.credentials.mfaStatus(userId);

    if (mfa.enrolled) return 'mfa';

    const project = await this.entries.policy(projectId);

    if (!project) return 'enroll_mfa';

    const entry = await this.entries.assess(userId, project);

    return entry.secondFactorRequired ? 'enroll_mfa' : null;
  }

  async secondFactorStage(userId: string): Promise<SecondFactorStage> {
    const mfa = await this.credentials.mfaStatus(userId);

    return mfa.enrolled ? 'mfa' : 'enroll_mfa';
  }

  open(res: Response, step: Omit<LoginStepCookie, 'createdAt'>): void {
    this.cookies.set(
      res,
      SSO_STEP_COOKIE,
      { ...step, createdAt: Math.floor(Date.now() / 1000) },
      STEP_COOKIE_TTL_SECONDS,
      { sameSite: 'lax' },
    );
  }

  read(req: Request): LoginStepCookie | null {
    const step = this.cookies.get<LoginStepCookie>(req, SSO_STEP_COOKIE);

    if (!step) return null;

    const age = Math.floor(Date.now() / 1000) - step.createdAt;

    return age > STEP_COOKIE_TTL_SECONDS ? null : step;
  }

  require(req: Request, stage: LoginStage): LoginStepCookie {
    const step = this.read(req);

    if (!step || step.stage !== stage) {
      throw new ApiException('login_step_expired');
    }

    return step;
  }

  clear(res: Response): void {
    this.cookies.clear(res, SSO_STEP_COOKIE, { sameSite: 'lax' });
  }
}
