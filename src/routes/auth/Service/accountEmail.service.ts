import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomBytes } from 'node:crypto';
import { AccountEmailKind } from 'generated/prisma/enums';
import { PROJECT_ACCESS_POLICY_FIELDS } from 'src/global/access/projectPolicy';
import { PrismaService } from 'src/global/prisma/prisma.service';
import {
  ACCOUNT_EMAILS_PER_HOUR,
  ACCOUNT_LINK_PATH,
  ACCOUNT_LINK_TOKEN_BYTES,
  ACCOUNT_LINK_TTL_MINUTES,
  ACCOUNT_TOKEN_MAX_LENGTH,
} from '../account.constant';

export interface AccountEmailContext {
  email: string;
  userId?: string | null;
  projectId: string;
  redirectUri: string;
  locale: string;
}

type LinkKind =
  typeof AccountEmailKind.SIGNUP | typeof AccountEmailKind.PASSWORD_RESET;

const QUOTA_KINDS: AccountEmailKind[] = [
  AccountEmailKind.SIGNUP,
  AccountEmailKind.PASSWORD_RESET,
  AccountEmailKind.ACCOUNT_EXISTS,
];

@Injectable()
export class AccountEmailService {
  private readonly linkBase: URL;

  constructor(
    private readonly prisma: PrismaService,
    config: ConfigService,
  ) {
    this.linkBase = new URL(
      ACCOUNT_LINK_PATH,
      config.getOrThrow<string>('SSO_LOGIN_URL'),
    );
  }

  async withinQuota(email: string): Promise<boolean> {
    const sent = await this.prisma.accountEmail.count({
      where: {
        email,
        kind: { in: QUOTA_KINDS },
        createdAt: { gte: new Date(Date.now() - 60 * 60 * 1000) },
      },
    });

    return sent < ACCOUNT_EMAILS_PER_HOUR;
  }

  async issueLink(
    kind: LinkKind,
    context: AccountEmailContext,
  ): Promise<string> {
    const raw = randomBytes(ACCOUNT_LINK_TOKEN_BYTES).toString('base64url');
    const now = new Date();

    await this.prisma.$transaction([
      this.prisma.accountEmail.updateMany({
        where: {
          email: context.email,
          kind,
          consumedAt: null,
          expiresAt: { gt: now },
        },
        data: { expiresAt: now },
      }),
      this.prisma.accountEmail.create({
        data: {
          kind,
          email: context.email,
          userId: context.userId ?? null,
          projectId: context.projectId,
          redirectUri: context.redirectUri,
          locale: context.locale,
          tokenHash: this.hash(raw),
          createdAt: now,
          expiresAt: new Date(
            now.getTime() + ACCOUNT_LINK_TTL_MINUTES * 60 * 1000,
          ),
        },
      }),
    ]);

    return raw;
  }

  async record(
    kind:
      | typeof AccountEmailKind.ACCOUNT_EXISTS
      | typeof AccountEmailKind.PASSWORD_CHANGED,
    context: AccountEmailContext,
  ): Promise<void> {
    await this.prisma.accountEmail.create({
      data: {
        kind,
        email: context.email,
        userId: context.userId ?? null,
        projectId: context.projectId,
        redirectUri: context.redirectUri,
        locale: context.locale,
        createdAt: new Date(),
      },
    });
  }

  async findLive(raw: string) {
    if (!raw || raw.length > ACCOUNT_TOKEN_MAX_LENGTH) return null;

    return this.prisma.accountEmail.findFirst({
      where: {
        tokenHash: this.hash(raw),
        consumedAt: null,
        expiresAt: { gt: new Date() },
        kind: {
          in: [AccountEmailKind.SIGNUP, AccountEmailKind.PASSWORD_RESET],
        },
      },
      include: {
        project: {
          select: {
            ...PROJECT_ACCESS_POLICY_FIELDS,
            displayName: true,
            logo: true,
          },
        },
      },
    });
  }

  linkUrl(raw: string): string {
    const url = new URL(this.linkBase);

    url.hash = `token=${raw}`;

    return url.toString();
  }

  private hash(raw: string): string {
    return createHash('sha256').update(raw).digest('hex');
  }
}
