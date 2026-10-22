import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request, Response } from 'express';
import { AccountEmailKind } from 'generated/prisma/enums';
import { SSO_SELF_PROJECT_NAME } from 'src/global/constants/selfProject.constant';
import { CookieService } from 'src/global/cookie/cookie.service';
import { ApiException } from 'src/global/error/apiError';
import { MailerService } from 'src/global/mail/mailer.service';
import { PrismaService } from 'src/global/prisma/prisma.service';
import {
  ACCOUNT_LINK_TTL_MINUTES,
  ACCOUNT_PAGE_PATH,
} from '../account.constant';
import { SSO_SESSION_COOKIE } from '../auth.constant';
import {
  AccountDeletionRequest,
  AccountDeletionView,
  AccountLinkToken,
} from '../dto/account.dto';
import { accountLocale, composeAccountMail } from '../mail/accountMail';
import { AccountEmailService } from './accountEmail.service';
import { AccountProfileService } from './accountProfile.service';

type ErasureOutcome =
  | { status: 'deleted'; projects: number }
  | { status: 'admin' }
  | { status: 'invalid' };

@Injectable()
export class AccountDeletionService {
  private readonly logger = new Logger(AccountDeletionService.name);
  private readonly accountPage: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly profiles: AccountProfileService,
    private readonly emails: AccountEmailService,
    private readonly mailer: MailerService,
    private readonly cookies: CookieService,
    config: ConfigService,
  ) {
    this.accountPage = new URL(
      ACCOUNT_PAGE_PATH,
      config.getOrThrow<string>('SSO_LOGIN_URL'),
    ).toString();
  }

  async request(
    req: Request,
    res: Response,
    body: AccountDeletionRequest,
  ): Promise<AccountDeletionView> {
    const { session } = await this.profiles.requireWriter(req, res);

    const [user, identityProvider] = await Promise.all([
      this.prisma.user.findUnique({
        where: { id: session.userId },
        select: { id: true, email: true },
      }),
      this.prisma.project.findUnique({
        where: { name: SSO_SELF_PROJECT_NAME },
        select: { id: true, name: true, displayName: true },
      }),
    ]);

    if (!user || !identityProvider) throw new ApiException('login_required');

    if (await this.administers(user.id)) {
      throw new ApiException('account_deletion_admin');
    }

    if (!this.mailer.available) throw new ApiException('email_unavailable');

    if (!(await this.emails.withinQuota(user.email))) {
      throw new ApiException('account_email_quota');
    }

    const locale = accountLocale(body.locale);
    const token = await this.emails.issueLink(
      AccountEmailKind.ACCOUNT_DELETION,
      {
        email: user.email,
        userId: user.id,
        projectId: identityProvider.id,
        redirectUri: this.accountPage,
        locale,
      },
    );

    try {
      await this.mailer.send(
        composeAccountMail({
          to: user.email,
          template: 'deletion',
          locale,
          application: identityProvider.displayName ?? identityProvider.name,
          link: this.emails.linkUrl(token),
          validityMinutes: ACCOUNT_LINK_TTL_MINUTES,
        }),
      );
    } catch (error) {
      const failure = error as { responseCode?: number; code?: string };

      this.logger.error(
        `e-mail de exclusao de conta nao saiu (${failure.responseCode ?? failure.code ?? 'sem codigo'})`,
      );

      throw new ApiException('email_unavailable');
    }

    this.logger.log(`exclusao de conta pedida pela propria pessoa: ${user.id}`);

    return { next: 'check_email', email: user.email };
  }

  async complete(
    res: Response,
    body: AccountLinkToken,
  ): Promise<AccountDeletionView> {
    const link = await this.emails.findLive(body.token);

    if (
      !link ||
      link.kind !== AccountEmailKind.ACCOUNT_DELETION ||
      !link.userId
    ) {
      throw new ApiException('link_invalid');
    }

    const outcome = await this.erase(link.id, link.userId);

    if (outcome.status === 'admin') {
      throw new ApiException('account_deletion_admin');
    }

    if (outcome.status === 'invalid') throw new ApiException('link_invalid');

    this.cookies.clear(res, SSO_SESSION_COOKIE);
    this.profiles.clearPending(res);

    this.logger.log(
      `conta excluida pela propria pessoa: ${link.userId}; aviso para ${outcome.projects} aplicacao(oes)`,
    );

    return { next: 'deleted' };
  }

  private async administers(userId: string): Promise<boolean> {
    const roles = await this.prisma.projectUser.count({
      where: { userId, project: { name: SSO_SELF_PROJECT_NAME } },
    });

    return roles > 0;
  }

  private erase(linkId: string, userId: string): Promise<ErasureOutcome> {
    return this.prisma.$transaction(async (tx): Promise<ErasureOutcome> => {
      const now = new Date();

      const consumed = await tx.accountEmail.updateMany({
        where: { id: linkId, consumedAt: null, expiresAt: { gt: now } },
        data: { consumedAt: now },
      });

      if (consumed.count !== 1) return { status: 'invalid' };

      const locked = await tx.$queryRaw<
        { email: string }[]
      >`SELECT email FROM "User" WHERE id = ${userId} FOR UPDATE`;

      if (locked.length === 0) return { status: 'invalid' };

      const administrator = await tx.projectUser.count({
        where: { userId, project: { name: SSO_SELF_PROJECT_NAME } },
      });

      if (administrator > 0) return { status: 'admin' };

      const memberships = await tx.projectUser.findMany({
        where: { userId },
        select: { projectId: true },
      });
      const blocks = await tx.projectBlock.findMany({
        where: { userId },
        select: { projectId: true },
      });
      const projectIds = [
        ...new Set([...memberships, ...blocks].map((row) => row.projectId)),
      ];

      const sessions = await tx.$queryRaw<
        { id: string }[]
      >`SELECT id FROM "AuthSession" WHERE "userId" = ${userId} FOR UPDATE`;
      const sessionIds = sessions.map((session) => session.id);

      await tx.authorizationCode.deleteMany({
        where: { OR: [{ userId }, { authSessionId: { in: sessionIds } }] },
      });
      await tx.refreshToken.deleteMany({
        where: { OR: [{ userId }, { authSessionId: { in: sessionIds } }] },
      });
      await tx.authSession.deleteMany({ where: { userId } });
      await tx.projectUser.deleteMany({ where: { userId } });
      await tx.accountEmail.deleteMany({
        where: {
          OR: [
            { userId },
            { email: { equals: locked[0].email, mode: 'insensitive' } },
          ],
        },
      });
      await tx.user.delete({ where: { id: userId } });

      if (projectIds.length > 0) {
        await tx.deletedAccount.createMany({
          data: projectIds.map((projectId) => ({
            subject: userId,
            projectId,
            deletedAt: now,
          })),
          skipDuplicates: true,
        });
      }

      return { status: 'deleted', projects: projectIds.length };
    });
  }
}
