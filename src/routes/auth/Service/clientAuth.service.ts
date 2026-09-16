import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Project } from 'generated/prisma/client';
import { ProjectStatus } from 'generated/prisma/enums';
import { PrismaService } from 'src/global/prisma/prisma.service';
import { CLIENT_ASSERTION_TYPE } from '../dto/token.dto';
import { OAuthException } from '../error/oauth.exception';

/**
 * O minimo que um corpo precisa ter para autenticar o cliente. Token endpoint
 * e revocation endpoint compartilham este contrato (RFC 7009 secao 2.1 manda
 * o revoke usar a mesma autenticacao do token).
 */
export interface ClientAuthenticatable {
  client_id?: string;
  client_assertion_type?: string;
  client_assertion?: string;
}

/**
 * Autenticacao do cliente no token endpoint via `private_key_jwt`
 * (RFC 7523 secao 2.2).
 *
 * As aplicacoes clientes sao backends registrados aqui, nao paginas: quem
 * troca o code por token e o servidor delas. A RFC 10017 secao 6.2.3.1 diz
 * que um token-mediating backend MUST agir como cliente confidencial, entao
 * PKCE sozinho nao basta.
 *
 * A escolha por asserção assinada em vez de client_secret evita reintroduzir
 * um segredo compartilhado, que e exatamente o problema que a migracao para
 * RS256 esta removendo. O SSO guarda so a chave publica do cliente.
 */
@Injectable()
export class ClientAuthService {
  /** A RFC 7523 secao 3 manda recusar `exp` distante demais no futuro. */
  private static readonly MAX_ASSERTION_LIFETIME_SECONDS = 300;

  private readonly logger = new Logger(ClientAuthService.name);
  private readonly issuer: string;
  private readonly tokenEndpoint: string;

  constructor(
    private prisma: PrismaService,
    private jwt: JwtService,
    config: ConfigService,
  ) {
    this.issuer = config.getOrThrow<string>('SSO_ISSUER').replace(/\/+$/, '');
    this.tokenEndpoint = `${this.issuer}/oauth/token`;
  }

  async authenticate(body: ClientAuthenticatable): Promise<Project> {
    if (body.client_assertion_type !== CLIENT_ASSERTION_TYPE) {
      throw OAuthException.invalidClient(
        `client_assertion_type deve ser ${CLIENT_ASSERTION_TYPE}`,
      );
    }

    if (!body.client_assertion) {
      throw OAuthException.invalidClient('client_assertion ausente');
    }

    const clientId = this.readClientIdFromAssertion(body.client_assertion);

    if (body.client_id && body.client_id !== clientId) {
      throw OAuthException.invalidClient(
        'client_id nao confere com o issuer da asserção',
      );
    }

    const project = await this.prisma.project.findUnique({
      where: { clientId },
      include: {
        clientKeys: {
          where: {
            revokedAt: null,
            OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
          },
        },
      },
    });

    if (!project) {
      throw OAuthException.invalidClient('client_id desconhecido');
    }

    // Mesma trava do authorize endpoint, repetida aqui de proposito: o token
    // endpoint e alcancavel diretamente, sem passar pelo authorize. Suspender
    // um projeto precisa cortar tambem a renovacao por refresh token.
    if (project.status !== ProjectStatus.ACTIVE) {
      this.logger.warn(
        `token recusado: projeto ${project.name} esta ${project.status}`,
      );

      throw OAuthException.invalidClient(
        'este cliente nao esta autorizado a usar o SSO',
      );
    }

    if (project.clientKeys.length === 0) {
      throw OAuthException.invalidClient(
        'nenhuma chave publica ativa registrada para este cliente',
      );
    }

    await this.verifyAssertion(
      body.client_assertion,
      clientId,
      project.clientKeys,
    );

    return project;
  }

  /**
   * Le `iss` sem verificar assinatura, apenas para localizar as chaves.
   * Nada deste passo e confiavel ate a verificacao acontecer.
   */
  private readClientIdFromAssertion(assertion: string): string {
    const decoded = this.jwt.decode<{
      iss?: unknown;
      sub?: unknown;
    } | null>(assertion);

    const iss = decoded?.iss;
    const sub = decoded?.sub;

    if (typeof iss !== 'string' || !iss) {
      throw OAuthException.invalidClient('asserção sem claim iss');
    }

    // RFC 7523 secao 3: para autenticacao de cliente, iss e sub sao o client_id.
    if (sub !== iss) {
      throw OAuthException.invalidClient('asserção com iss diferente de sub');
    }

    return iss;
  }

  private async verifyAssertion(
    assertion: string,
    clientId: string,
    keys: Array<{ id: string; publicKeyPem: string; algorithm: string }>,
  ): Promise<void> {
    for (const key of keys) {
      try {
        const payload = await this.jwt.verifyAsync<{ exp: number }>(assertion, {
          publicKey: key.publicKeyPem,
          algorithms: ['RS256'],
          issuer: clientId,
          subject: clientId,
          // `aud` deve nomear o AS. Aceito o token endpoint e o issuer:
          // a RFC 7523 secao 3 permite as duas leituras e implementacoes
          // reais divergem sobre qual usar.
          audience: [this.tokenEndpoint, this.issuer],
        });

        const lifetime = payload.exp - Math.floor(Date.now() / 1000);

        if (lifetime > ClientAuthService.MAX_ASSERTION_LIFETIME_SECONDS) {
          throw OAuthException.invalidClient(
            'asserção com validade longa demais',
          );
        }

        return;
      } catch (error) {
        if (error instanceof OAuthException) throw error;
        // Chave errada e esperado quando o cliente tem mais de uma
        // registrada: seguimos tentando as demais.
        continue;
      }
    }

    this.logger.warn(`asserção de cliente invalida para client_id ${clientId}`);

    throw OAuthException.invalidClient('asserção de cliente invalida');
  }
}
