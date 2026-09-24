import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'node:crypto';
import { PrismaService } from 'src/global/prisma/prisma.service';
import { OAuthException } from '../error/oauth.exception';

export interface IssueRefreshTokenParams {
  userId: string;
  projectId: string;
  authSessionId: string;
  familyId?: string;
  expiresAt?: Date;
}

export interface RotatedRefreshToken {
  token: string;
  userId: string;
  projectId: string;
  authSessionId: string;
}

@Injectable()
export class RefreshTokenService {
  private static readonly TOKEN_BYTES = 32;
  private static readonly DEFAULT_TTL_SECONDS = 14 * 24 * 60 * 60;

  private readonly logger = new Logger(RefreshTokenService.name);
  private readonly ttlSeconds: number;

  constructor(
    private prisma: PrismaService,
    config: ConfigService,
  ) {
    const configured = Number(
      config.get<string>(
        'REFRESH_TOKEN_TTL',
        String(RefreshTokenService.DEFAULT_TTL_SECONDS),
      ),
    );

    this.ttlSeconds =
      Number.isFinite(configured) && configured > 0
        ? configured
        : RefreshTokenService.DEFAULT_TTL_SECONDS;
  }

  async issue(params: IssueRefreshTokenParams): Promise<string> {
    const raw = crypto
      .randomBytes(RefreshTokenService.TOKEN_BYTES)
      .toString('base64url');

    await this.prisma.refreshToken.create({
      data: {
        tokenHash: this.hash(raw),
        familyId: params.familyId ?? crypto.randomUUID(),
        userId: params.userId,
        projectId: params.projectId,
        authSessionId: params.authSessionId,
        expiresAt:
          params.expiresAt ?? new Date(Date.now() + this.ttlSeconds * 1000),
      },
    });

    return raw;
  }

  async rotate(raw: string, projectId: string): Promise<RotatedRefreshToken> {
    const tokenHash = this.hash(raw);

    const outcome = await this.prisma.$transaction(async (tx) => {
      const existing = await tx.refreshToken.findUnique({
        where: { tokenHash },
      });

      if (!existing) return { kind: 'unknown' as const };

      if (existing.projectId !== projectId) {
        return { kind: 'wrong_client' as const };
      }

      if (existing.revokedAt) return { kind: 'revoked' as const };

      if (existing.consumedAt) {
        return { kind: 'reused' as const, familyId: existing.familyId };
      }

      if (existing.expiresAt.getTime() <= Date.now()) {
        return { kind: 'expired' as const };
      }

      const session = await tx.authSession.findUnique({
        where: { id: existing.authSessionId },
      });

      if (!session || session.revokedAt || session.expiresAt <= new Date()) {
        return { kind: 'session_gone' as const, familyId: existing.familyId };
      }

      const nextRaw = crypto
        .randomBytes(RefreshTokenService.TOKEN_BYTES)
        .toString('base64url');

      const next = await tx.refreshToken.create({
        data: {
          tokenHash: this.hash(nextRaw),
          familyId: existing.familyId,
          userId: existing.userId,
          projectId: existing.projectId,
          authSessionId: existing.authSessionId,
          expiresAt: existing.expiresAt,
        },
      });

      await tx.refreshToken.update({
        where: { id: existing.id },
        data: { consumedAt: new Date(), replacedById: next.id },
      });

      return {
        kind: 'ok' as const,
        token: nextRaw,
        userId: existing.userId,
        projectId: existing.projectId,
        authSessionId: existing.authSessionId,
      };
    });

    switch (outcome.kind) {
      case 'ok':
        return {
          token: outcome.token,
          userId: outcome.userId,
          projectId: outcome.projectId,
          authSessionId: outcome.authSessionId,
        };

      case 'unknown':
        throw new OAuthException('invalid_grant', 'refresh_token desconhecido');

      case 'wrong_client':
        throw new OAuthException(
          'invalid_grant',
          'refresh_token emitido para outro cliente',
        );

      case 'revoked':
        throw new OAuthException('invalid_grant', 'refresh_token revogado');

      case 'expired':
        throw new OAuthException('invalid_grant', 'refresh_token expirado');

      case 'session_gone':
        await this.revokeFamily(outcome.familyId);
        throw new OAuthException('invalid_grant', 'sessao encerrada');

      case 'reused': {
        await this.revokeFamily(outcome.familyId);

        this.logger.warn(
          `reuso de refresh token detectado; familia ${outcome.familyId} revogada`,
        );

        throw new OAuthException(
          'invalid_grant',
          'refresh_token ja utilizado; a sessao foi encerrada por seguranca',
        );
      }
    }
  }

  private async revokeFamily(familyId: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { familyId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async revokeByToken(raw: string, projectId: string): Promise<boolean> {
    const existing = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: this.hash(raw) },
    });

    if (!existing || existing.projectId !== projectId) return false;

    await this.revokeFamily(existing.familyId);

    return true;
  }

  async revokeForSessionAndProject(
    authSessionId: string,
    projectId: string,
  ): Promise<number> {
    const { count } = await this.prisma.refreshToken.updateMany({
      where: { authSessionId, projectId, revokedAt: null },
      data: { revokedAt: new Date() },
    });

    return count;
  }

  async revokeForSession(authSessionId: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { authSessionId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  private hash(raw: string): string {
    return crypto.createHash('sha256').update(raw).digest('hex');
  }
}
