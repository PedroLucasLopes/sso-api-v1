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

/**
 * Authorization code em Postgres, nao em Redis.
 *
 * Nao da para mover este estado para cookie: quem apresenta o code no token
 * endpoint e o backend do RP, numa requisicao que nao carrega cookie nenhum
 * do navegador do usuario. E o uso unico exigido pela RFC 6749 secao 4.1.2
 * precisa de estado compartilhado de qualquer forma.
 *
 * O consumo e um UPDATE condicional dentro de transacao, entao duas trocas
 * simultaneas do mesmo code nao passam as duas. A implementacao anterior lia
 * e apagava em chamadas separadas, o que deixava a corrida aberta.
 */
@Injectable()
export class AuthorizationCodeService {
  /** Bem abaixo do teto de 10 minutos sugerido pela RFC 6749 secao 4.1.2. */
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

    // A transacao decide o que aconteceu, mas nao lanca nada: lancar aqui
    // dispararia rollback e desfaria a propria revogacao de seguranca. Por
    // isso o efeito colateral e a excecao ficam do lado de fora.
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

      // Uso unico: so passa quem realmente virou a linha de nao-consumida
      // para consumida.
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
      // RFC 9700 secao 2.1.1: reapresentacao e tratada como ataque, e tudo
      // que foi emitido a partir daquele code cai junto.
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

  /**
   * Verificacao PKCE (RFC 7636 secao 4.6).
   * Comparacao em tempo constante: o desafio nao e segredo, mas comparar
   * hashes assim e barato e evita canal lateral por tempo.
   */
  verifyChallenge(codeVerifier: string, expectedChallenge: string): boolean {
    const computed = crypto
      .createHash('sha256')
      .update(codeVerifier, 'ascii')
      .digest('base64url');

    const a = Buffer.from(computed);
    const b = Buffer.from(expectedChallenge);

    return a.length === b.length && crypto.timingSafeEqual(a, b);
  }

  /** Housekeeping: linhas expiradas nao servem mais nem para auditoria. */
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
