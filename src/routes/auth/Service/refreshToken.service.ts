import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'node:crypto';
import { PrismaService } from 'src/global/prisma/prisma.service';
import { OAuthException } from '../error/oauth.exception';

export interface IssueRefreshTokenParams {
  userId: string;
  projectId: string;
  authSessionId: string;
  /** Ausente cria uma familia nova; presente continua a existente. */
  familyId?: string;
  /** Teto absoluto herdado da familia. Nunca e estendido na rotacao. */
  expiresAt?: Date;
}

export interface RotatedRefreshToken {
  token: string;
  userId: string;
  projectId: string;
  authSessionId: string;
}

/**
 * Refresh token com rotacao obrigatoria e deteccao de reuso.
 *
 * RFC 9700 secao 2.2.2 exige, para cliente publico, refresh token
 * sender-constrained ou rotativo. RFC 10017 secao 6.3.2.3 acrescenta que o
 * AS MUST rotacionar a cada uso, MUST ter teto de validade e MUST NOT
 * estender esse teto na rotacao.
 *
 * Como o token e rotativo, apresentar um token ja consumido so acontece em
 * dois cenarios: corrida do cliente legitimo ou token roubado sendo usado em
 * paralelo. Nao da para distinguir os dois, entao o tratamento seguro e o
 * mesmo: revogar a familia inteira e forcar login novo.
 *
 * Guardamos apenas o SHA-256 do token. Vazamento do banco nao entrega
 * credencial utilizavel.
 */
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

  /**
   * Consome o token apresentado e emite o proximo da mesma familia.
   * Tudo numa transacao para que duas requisicoes simultaneas nao consigam
   * consumir o mesmo token.
   */
  async rotate(raw: string, projectId: string): Promise<RotatedRefreshToken> {
    const tokenHash = this.hash(raw);

    // Nada e lancado de dentro da transacao: um throw dispararia rollback e
    // desfaria a revogacao da familia, que e justamente a resposta de
    // seguranca que precisa persistir.
    const outcome = await this.prisma.$transaction(async (tx) => {
      const existing = await tx.refreshToken.findUnique({
        where: { tokenHash },
      });

      if (!existing) return { kind: 'unknown' as const };

      if (existing.projectId !== projectId) {
        // Token de outro cliente. Nao derruba a familia: quem errou foi quem
        // apresentou, e revogar puniria o dono legitimo.
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

      // RFC 10017 secao 6.3.2.3: a vida do refresh token acompanha a sessao.
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
          // Teto herdado, nunca estendido.
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
        // Reuso de token rotativo. Nao da para distinguir corrida do cliente
        // legitimo de token roubado, entao o tratamento seguro e o mesmo.
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

  /**
   * Revogacao a pedido do cliente (RFC 7009).
   *
   * Derruba a familia inteira, e nao so o token apresentado: como a rotacao
   * encadeia os tokens, deixar os irmaos vivos manteria a sessao renovavel e
   * o logout nao significaria nada.
   *
   * Nao lanca quando o token e desconhecido. A RFC 7009 secao 2.2 manda o
   * servidor responder 200 nesse caso, para nao virar oraculo que diz quais
   * tokens existem.
   */
  async revokeByToken(raw: string, projectId: string): Promise<boolean> {
    const existing = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: this.hash(raw) },
    });

    // Token de outro cliente: ignora em silencio. Um cliente nao pode
    // derrubar a sessao de outro apresentando um token que capturou.
    if (!existing || existing.projectId !== projectId) return false;

    await this.revokeFamily(existing.familyId);

    return true;
  }

  /**
   * Usado quando um authorization code e reapresentado: a RFC 9700 secao
   * 2.1.1 manda revogar tudo que foi emitido a partir daquele code.
   */
  async revokeForSessionAndProject(
    authSessionId: string,
    projectId: string,
  ): Promise<number> {
    const { count } = await this.prisma.refreshToken.updateMany({
      where: {
        authSessionId: { equals: authSessionId },
        projectId: { equals: projectId },
        revokedAt: null,
      },
      data: { revokedAt: new Date() },
    });

    return count;
  }

  async revokeForSession(authSessionId: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { authSessionId: { equals: authSessionId }, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  private hash(raw: string): string {
    return crypto.createHash('sha256').update(raw).digest('hex');
  }
}
