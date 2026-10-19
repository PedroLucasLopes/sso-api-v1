import { Injectable, Logger } from '@nestjs/common';
import { Request, Response } from 'express';
import { AccountEmailKind } from 'generated/prisma/enums';
import {
  acceptsSignup,
  PROJECT_ACCESS_POLICY_FIELDS,
  ProjectAccessPolicy,
} from 'src/global/access/projectPolicy';
import { CookieService } from 'src/global/cookie/cookie.service';
import { hashPassword } from 'src/global/crypto/password';
import {
  chosenPasswordProblem,
  PasswordOwner,
} from 'src/global/crypto/passwordPolicy';
import { ApiException } from 'src/global/error/apiError';
import { MailerService } from 'src/global/mail/mailer.service';
import { PrismaService } from 'src/global/prisma/prisma.service';
import { PwnedPasswordsService } from 'src/global/security/pwnedPasswords.service';
import { ACCOUNT_LINK_TTL_MINUTES } from '../account.constant';
import { SSO_SESSION_COOKIE } from '../auth.constant';
import {
  AccountEmailRequest,
  AccountLinkToken,
  AccountLinkView,
  AccountPassword,
  AccountSignup,
} from '../dto/account.dto';
import { LoginStepView } from '../dto/loginStep.dto';
import { LoginTransaction } from '../dto/pkceTransaction.dto';
import { accountLocale, composeAccountMail } from '../mail/accountMail';
import { AccountMailTemplate } from '../mail/accountMail.messages';
import {
  AccountEmailContext,
  AccountEmailService,
} from './accountEmail.service';
import { AuthService } from './auth.service';
import { LoginFlowService } from './loginFlow.service';
import { LoginStepService } from './loginStep.service';
import { ProjectEntryService } from './projectEntry.service';

interface BrandedProject extends ProjectAccessPolicy {
  displayName: string | null;
}

interface ExistingAccount {
  id: string;
  email: string;
  hasPassword: boolean;
}

@Injectable()
export class AccountService {
  private readonly logger = new Logger(AccountService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auth: AuthService,
    private readonly flow: LoginFlowService,
    private readonly steps: LoginStepService,
    private readonly entries: ProjectEntryService,
    private readonly emails: AccountEmailService,
    private readonly mailer: MailerService,
    private readonly pwned: PwnedPasswordsService,
    private readonly cookies: CookieService,
  ) {}

  async requestSignup(
    req: Request,
    body: AccountEmailRequest,
  ): Promise<LoginStepView> {
    const { transaction, project } = await this.openRequest(req);
    const context = this.context(body, project.id, transaction);

    this.later(() =>
      this.deliverSignup(context, this.applicationName(project)),
    );

    return { next: 'check_email', email: context.email };
  }

  async requestPasswordReset(
    req: Request,
    body: AccountEmailRequest,
  ): Promise<LoginStepView> {
    const { transaction, project } = await this.openRequest(req);
    const context = this.context(body, project.id, transaction);

    this.later(() => this.deliverReset(context, this.applicationName(project)));

    return { next: 'check_email', email: context.email };
  }

  async describeLink(body: AccountLinkToken): Promise<AccountLinkView> {
    const link = await this.emails.findLive(body.token);

    if (!link) throw new ApiException('link_invalid');

    if (
      link.kind === AccountEmailKind.SIGNUP &&
      (await this.findAccount(link.email))
    ) {
      throw new ApiException('link_invalid');
    }

    return {
      purpose: link.kind === AccountEmailKind.SIGNUP ? 'signup' : 'password',
      email: link.email,
      application: this.applicationName(link.project),
      logo: link.project.logo,
    };
  }

  async completeSignup(
    req: Request,
    res: Response,
    body: AccountSignup,
  ): Promise<LoginStepView> {
    const link = await this.emails.findLive(body.token);

    if (!link || link.kind !== AccountEmailKind.SIGNUP) {
      throw new ApiException('link_invalid');
    }

    const project = link.project;
    const defaultRoleId = project.defaultRoleId;

    if (!acceptsSignup(project) || !defaultRoleId) {
      throw new ApiException('signup_closed');
    }

    const name = body.name.trim().replace(/\s+/g, ' ');

    await this.assertChosenPassword(body.password, {
      email: link.email,
      name,
      serviceNames: this.serviceNames(project),
    });

    const hash = await hashPassword(body.password);

    const userId = await this.prisma.$transaction(async (tx) => {
      const now = new Date();

      const consumed = await tx.accountEmail.updateMany({
        where: { id: link.id, consumedAt: null, expiresAt: { gt: now } },
        data: { consumedAt: now },
      });

      if (consumed.count !== 1) return null;

      const taken = await tx.user.findFirst({
        where: { email: { equals: link.email, mode: 'insensitive' } },
        select: { id: true },
      });

      if (taken) return null;

      const user = await tx.user.create({
        data: {
          email: link.email,
          name,
          password: { create: { hash, mustChange: false } },
        },
        select: { id: true },
      });

      await tx.projectUser.create({
        data: { userId: user.id, projectId: project.id, roleId: defaultRoleId },
      });

      await tx.accountEmail.updateMany({
        where: {
          email: link.email,
          kind: AccountEmailKind.SIGNUP,
          consumedAt: null,
          expiresAt: { gt: now },
        },
        data: { expiresAt: now },
      });

      return user.id;
    });

    if (!userId) throw new ApiException('link_invalid');

    this.logger.log(
      `conta criada pelo cadastro no projeto ${project.name}: ${userId}`,
    );

    return this.afterAccountReady(
      req,
      res,
      { id: userId, email: link.email },
      project,
      link.redirectUri,
    );
  }

  async completePasswordReset(
    res: Response,
    body: AccountPassword,
  ): Promise<LoginStepView> {
    const link = await this.emails.findLive(body.token);

    if (
      !link ||
      link.kind !== AccountEmailKind.PASSWORD_RESET ||
      !link.userId
    ) {
      throw new ApiException('link_invalid');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: link.userId },
      select: { id: true, email: true, name: true },
    });

    if (!user) throw new ApiException('link_invalid');

    await this.assertChosenPassword(body.password, {
      email: user.email,
      name: user.name,
      serviceNames: this.serviceNames(link.project),
    });

    const hash = await hashPassword(body.password);

    const changed = await this.prisma.$transaction(async (tx) => {
      const now = new Date();

      const credential = await tx.userPassword.findUnique({
        where: { userId: user.id },
        select: { userId: true },
      });

      if (!credential) return false;

      const consumed = await tx.accountEmail.updateMany({
        where: { id: link.id, consumedAt: null, expiresAt: { gt: now } },
        data: { consumedAt: now },
      });

      if (consumed.count !== 1) return false;

      await tx.userPassword.update({
        where: { userId: user.id },
        data: { hash, mustChange: false, failedCount: 0, lockedUntil: null },
      });

      await tx.accountEmail.updateMany({
        where: {
          userId: user.id,
          kind: AccountEmailKind.PASSWORD_RESET,
          consumedAt: null,
          expiresAt: { gt: now },
        },
        data: { expiresAt: now },
      });

      await tx.authorizationCode.deleteMany({
        where: { userId: user.id, consumedAt: null },
      });

      await tx.refreshToken.updateMany({
        where: { userId: user.id, revokedAt: null },
        data: { revokedAt: now },
      });

      await tx.authSession.updateMany({
        where: { userId: user.id, revokedAt: null },
        data: { revokedAt: now },
      });

      return true;
    });

    if (!changed) throw new ApiException('link_invalid');

    this.cookies.clear(res, SSO_SESSION_COOKIE);

    this.logger.log(
      `senha trocada pelo link: ${user.id}; todas as sessoes encerradas`,
    );

    const notice: AccountEmailContext = {
      email: user.email,
      userId: user.id,
      projectId: link.projectId,
      redirectUri: link.redirectUri,
      locale: link.locale,
    };

    this.later(() =>
      this.deliverNotice(notice, this.applicationName(link.project)),
    );

    return {
      next: 'credentials',
      email: user.email,
      continueTo: await this.continueTarget(link.projectId, link.redirectUri),
    };
  }

  private async afterAccountReady(
    req: Request,
    res: Response,
    account: { id: string; email: string },
    project: ProjectAccessPolicy,
    redirectUri: string,
  ): Promise<LoginStepView> {
    const entry = await this.entries.assess(account.id, project);
    const transaction = this.auth.pendingTransaction(req);
    const sameRequest =
      !!transaction &&
      transaction.kind !== 'session' &&
      transaction.projectId === project.id;

    if (entry.secondFactorRequired) {
      if (sameRequest) {
        this.steps.open(res, {
          userId: account.id,
          email: account.email,
          stage: 'enroll_mfa',
        });

        return { next: 'enroll_mfa', email: account.email };
      }

      return {
        next: 'credentials',
        email: account.email,
        continueTo: await this.continueTarget(project.id, redirectUri),
      };
    }

    if (sameRequest && transaction) {
      return this.flow.complete(req, res, account.id, transaction, {
        singleFactor: true,
      });
    }

    await this.auth.establishSession(res, account.id, {
      singleFactor: true,
      replacesSessionId: this.auth.sessionCookieId(req),
    });

    return {
      next: 'done',
      email: account.email,
      continueTo: await this.continueTarget(project.id, redirectUri),
    };
  }

  private async openRequest(
    req: Request,
  ): Promise<{ transaction: LoginTransaction; project: BrandedProject }> {
    const transaction = this.auth.requirePendingTransaction(req);

    if (transaction.kind === 'session') {
      throw new ApiException('signup_closed');
    }

    const project = await this.prisma.project.findUnique({
      where: { id: transaction.projectId },
      select: { ...PROJECT_ACCESS_POLICY_FIELDS, displayName: true },
    });

    if (!project || !acceptsSignup(project)) {
      throw new ApiException('signup_closed');
    }

    if (!this.mailer.available) throw new ApiException('email_unavailable');

    return { transaction, project };
  }

  private context(
    body: AccountEmailRequest,
    projectId: string,
    transaction: LoginTransaction,
  ): AccountEmailContext {
    return {
      email: body.email.trim().toLowerCase(),
      projectId,
      redirectUri: transaction.redirectUri,
      locale: accountLocale(body.locale),
    };
  }

  private async deliverSignup(
    context: AccountEmailContext,
    application: string,
  ): Promise<void> {
    if (!(await this.withinQuota(context))) return;

    const account = await this.findAccount(context.email);

    if (!account) {
      const token = await this.emails.issueLink(
        AccountEmailKind.SIGNUP,
        context,
      );

      await this.send(
        context,
        'signup',
        application,
        this.emails.linkUrl(token),
      );
      return;
    }

    await this.deliverExisting(
      account,
      context,
      application,
      'existsWithReset',
    );
  }

  private async deliverReset(
    context: AccountEmailContext,
    application: string,
  ): Promise<void> {
    if (!(await this.withinQuota(context))) return;

    const account = await this.findAccount(context.email);

    if (!account) return;

    await this.deliverExisting(account, context, application, 'reset');
  }

  private async deliverExisting(
    account: ExistingAccount,
    context: AccountEmailContext,
    application: string,
    template: Extract<AccountMailTemplate, 'existsWithReset' | 'reset'>,
  ): Promise<void> {
    const linked = { ...context, userId: account.id };
    const recipient = { ...linked, email: account.email };

    if (account.hasPassword) {
      const token = await this.emails.issueLink(
        AccountEmailKind.PASSWORD_RESET,
        linked,
      );

      await this.send(
        recipient,
        template,
        application,
        this.emails.linkUrl(token),
      );
      return;
    }

    await this.emails.record(AccountEmailKind.ACCOUNT_EXISTS, linked);
    await this.send(recipient, 'existsWithGoogle', application);
  }

  private async deliverNotice(
    context: AccountEmailContext,
    application: string,
  ): Promise<void> {
    await this.emails.record(AccountEmailKind.PASSWORD_CHANGED, context);
    await this.send(context, 'passwordChanged', application);
  }

  private async withinQuota(context: AccountEmailContext): Promise<boolean> {
    if (await this.emails.withinQuota(context.email)) return true;

    this.logger.warn('cota de e-mails de conta atingida para um endereco');

    return false;
  }

  private async send(
    context: AccountEmailContext,
    template: AccountMailTemplate,
    application: string,
    link?: string,
  ): Promise<void> {
    await this.mailer.send(
      composeAccountMail({
        to: context.email,
        template,
        locale: context.locale,
        application,
        link,
        validityMinutes: ACCOUNT_LINK_TTL_MINUTES,
      }),
    );
  }

  private later(work: () => Promise<void>): void {
    setImmediate(() => {
      work().catch((error: unknown) => {
        const failure = error as { responseCode?: number; code?: string };

        this.logger.error(
          `e-mail de conta nao saiu (${failure.responseCode ?? failure.code ?? 'sem codigo'})`,
        );
      });
    });
  }

  private async findAccount(email: string): Promise<ExistingAccount | null> {
    const user = await this.prisma.user.findFirst({
      where: { email: { equals: email, mode: 'insensitive' } },
      select: { id: true, email: true, password: { select: { userId: true } } },
    });

    return user
      ? { id: user.id, email: user.email, hasPassword: !!user.password }
      : null;
  }

  private async continueTarget(
    projectId: string,
    redirectUri: string,
  ): Promise<string | null> {
    const registered = await this.prisma.redirectUri.findUnique({
      where: { projectId_redirectUri: { projectId, redirectUri } },
      select: { id: true },
    });

    if (!registered) return null;

    try {
      return new URL(redirectUri).origin;
    } catch {
      return null;
    }
  }

  private async assertChosenPassword(
    password: string,
    owner: PasswordOwner,
  ): Promise<void> {
    const problem = chosenPasswordProblem(password, owner);

    if (problem)
      throw new ApiException('password_refused', { reason: problem });

    if (await this.pwned.isBreached(password)) {
      throw new ApiException('password_refused', { reason: 'breached' });
    }
  }

  private serviceNames(project: BrandedProject): string[] {
    return [project.name, project.displayName ?? ''];
  }

  private applicationName(project: BrandedProject): string {
    return project.displayName ?? project.name;
  }
}
