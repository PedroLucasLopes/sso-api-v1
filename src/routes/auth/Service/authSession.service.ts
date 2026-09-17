import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuthSession } from 'generated/prisma/client';
import { PrismaService } from 'src/global/prisma/prisma.service';

/**
 * Sessao do usuario com o proprio SSO, criada apos o login no Google.
 *
 * E o que faz este servidor ser de fato single sign-on: com uma sessao viva,
 * entrar num segundo projeto nao passa de novo pelo Google. Antes isso nao
 * existia, e todo /authorize refazia a federacao inteira.
 *
 * Tambem e a ancora de revogacao. RFC 10017 secao 6.3.2.3 recomenda amarrar
 * a vida do refresh token a esta sessao, entao encerra-la derruba os tokens
 * de todos os projetos de uma vez.
 */
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

  /** Devolve null para sessao inexistente, revogada ou expirada. */
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

  /**
   * Housekeeping: sessao vencida ha mais de um dia nao serve mais a ninguem.
   *
   * O refresh token e o authorization code apontam para a sessao, entao saem
   * antes dela. Apagar so a `AuthSession` batia na chave estrangeira e a
   * limpeza inteira falhava, sem limpar nada.
   */
  async purgeExpired(): Promise<number> {
    const corte = new Date(Date.now() - 24 * 60 * 60 * 1000);

    return this.prisma.$transaction(async (tx) => {
      const vencidas = await tx.authSession.findMany({
        where: { expiresAt: { lt: corte } },
        select: { id: true },
      });
      const ids = vencidas.map((sessao) => sessao.id);

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
