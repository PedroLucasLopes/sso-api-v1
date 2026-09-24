import { Injectable, Logger } from '@nestjs/common';
import * as crypto from 'node:crypto';
import { PrismaService } from 'src/global/prisma/prisma.service';
import { OAuthException } from '../error/oauth.exception';

export interface IssueCodeParams {
  userId: string;
  projectId: string;
  authSessionId: string;
  redirectUri: string;
  codeChallenge: string;
  codeChallengeMethod: string;
}

export interface ConsumedCode {
  userId: string;
  projectId: string;
  authSessionId: string;
  redirectUri: string;
  codeChallenge: string;
  codeChallengeMethod: string;
}

@Injectable()
export class AuthorizationCodeService {
  private static readonly TTL_SECONDS = 60;
  private static readonly CODE_BYTES = 32;

  private readonly logger = new Logger(AuthorizationCodeService.name);

  constructor(private prisma: PrismaService) {}

  async issue(params: IssueCodeParams): Promise<string> {
    const raw = crypto
      .randomBytes(AuthorizationCodeService.CODE_BYTES)
      .toString('base64url');

    await this.prisma.authorizationCode.create({
      data: {
        codeHash: this.hash(raw),
        userId: params.userId,
        projectId: params.projectId,
        authSessionId: params.authSessionId,
        redirectUri: params.redirectUri,
        codeChallenge: params.codeChallenge,
        codeChallengeMethod: params.codeChallengeMethod,
        expiresAt: new Date(
          Date.now() + AuthorizationCodeService.TTL_SECONDS * 1000,
        ),
      },
    });

    return raw;
  }

  async consume(raw: string): Promise<ConsumedCode> {
    const codeHash = this.hash(raw);

    const outcome = await this.prisma.$transaction(async (tx) => {
      const existing = await tx.authorizationCode.findUnique({
        where: { codeHash },
      });

      if (!existing) return { kind: 'unknown' as const };

      if (existing.consumedAt) {
        return { kind: 'replayed' as const, row: existing };
      }

      if (existing.expiresAt.getTime() <= Date.now()) {
        return { kind: 'expired' as const };
      }

      const claimed = await tx.authorizationCode.updateMany({
        where: { codeHash, consumedAt: null },
        data: { consumedAt: new Date() },
      });

      return claimed.count === 1
        ? { kind: 'ok' as const, row: existing }
        : { kind: 'replayed' as const, row: existing };
    });

    if (outcome.kind === 'unknown') {
      throw new OAuthException(
        'invalid_grant',
        'authorization code desconhecido',
      );
    }

    if (outcome.kind === 'expired') {
      throw new OAuthException('invalid_grant', 'authorization code expirado');
    }

    if (outcome.kind === 'replayed') {
      const revoked = await this.prisma.refreshToken.updateMany({
        where: {
          authSessionId: outcome.row.authSessionId,
          projectId: outcome.row.projectId,
          revokedAt: null,
        },
        data: { revokedAt: new Date() },
      });

      this.logger.warn(
        `authorization code reapresentado; ${revoked.count} refresh token(s) revogado(s)`,
      );

      throw new OAuthException(
        'invalid_grant',
        'authorization code ja utilizado',
      );
    }

    const { row } = outcome;

    return {
      userId: row.userId,
      projectId: row.projectId,
      authSessionId: row.authSessionId,
      redirectUri: row.redirectUri,
      codeChallenge: row.codeChallenge,
      codeChallengeMethod: row.codeChallengeMethod,
    };
  }

  verifyChallenge(codeVerifier: string, expectedChallenge: string): boolean {
    const computed = crypto
      .createHash('sha256')
      .update(codeVerifier, 'ascii')
      .digest('base64url');

    const a = Buffer.from(computed);
    const b = Buffer.from(expectedChallenge);

    return a.length === b.length && crypto.timingSafeEqual(a, b);
  }

  async purgeExpired(): Promise<number> {
    const { count } = await this.prisma.authorizationCode.deleteMany({
      where: { expiresAt: { lt: new Date(Date.now() - 60 * 60 * 1000) } },
    });

    return count;
  }

  private hash(raw: string): string {
    return crypto.createHash('sha256').update(raw).digest('hex');
  }
}
