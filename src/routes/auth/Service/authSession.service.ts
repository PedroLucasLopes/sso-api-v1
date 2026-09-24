import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuthSession } from 'generated/prisma/client';
import { PrismaService } from 'src/global/prisma/prisma.service';

@Injectable()
export class AuthSessionService {
  private static readonly DEFAULT_TTL_SECONDS = 12 * 60 * 60;

  private readonly ttlSeconds: number;

  constructor(
    private prisma: PrismaService,
    config: ConfigService,
  ) {
    const configured = Number(
      config.get<string>(
        'AUTH_SESSION_TTL',
        String(AuthSessionService.DEFAULT_TTL_SECONDS),
      ),
    );

    this.ttlSeconds =
      Number.isFinite(configured) && configured > 0
        ? configured
        : AuthSessionService.DEFAULT_TTL_SECONDS;
  }

  get maxAgeSeconds(): number {
    return this.ttlSeconds;
  }

  async create(userId: string): Promise<AuthSession> {
    return this.prisma.authSession.create({
      data: {
        userId,
        expiresAt: new Date(Date.now() + this.ttlSeconds * 1000),
      },
    });
  }

  async findValid(id: string): Promise<AuthSession | null> {
    const session = await this.prisma.authSession.findUnique({ where: { id } });

    if (!session) return null;
    if (session.revokedAt) return null;
    if (session.expiresAt.getTime() <= Date.now()) return null;

    return session;
  }

  async touch(id: string): Promise<void> {
    await this.prisma.authSession.update({
      where: { id },
      data: { lastSeenAt: new Date() },
    });
  }

  async revoke(id: string): Promise<void> {
    await this.prisma.authSession.updateMany({
      where: { id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async purgeExpired(): Promise<number> {
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);

    return this.prisma.$transaction(async (tx) => {
      const expired = await tx.authSession.findMany({
        where: { expiresAt: { lt: cutoff } },
        select: { id: true },
      });
      const ids = expired.map((session) => session.id);

      if (ids.length === 0) return 0;

      await tx.authorizationCode.deleteMany({
        where: { authSessionId: { in: ids } },
      });
      await tx.refreshToken.deleteMany({
        where: { authSessionId: { in: ids } },
      });

      const { count } = await tx.authSession.deleteMany({
        where: { id: { in: ids } },
      });

      return count;
    });
  }
}
