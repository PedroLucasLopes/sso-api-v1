import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import * as crypto from 'node:crypto';
import { KeyStatus } from 'generated/prisma/enums';
import { PrismaService } from 'src/global/prisma/prisma.service';
import { KeyEncryptionService } from 'src/global/crypto/keyEncryption.service';
import { ActiveSigningKey, Jwk, Jwks } from '../dto/jwks.dto';

/**
 * Ciclo de vida das chaves de assinatura do Authorization Server.
 *
 * Substitui o HS256 com segredo compartilhado: o SSO assina com a privada e
 * publica so a publica no JWKS. Um RP passa a verificar sem nunca poder emitir.
 *
 * Estados:
 *   ACTIVE  - assina agora. Sempre exatamente uma.
 *   NEXT    - ja publicada no JWKS mas ainda nao assina. Existe para que o RP
 *             tenha buscado a chave antes de ela comecar a ser usada.
 *   RETIRED - nao assina mais. Continua publicada durante a janela de graca,
 *             senao token ainda valido, assinado por ela, deixaria de verificar.
 */
@Injectable()
export class SigningKeyService implements OnModuleInit {
  private static readonly MODULUS_LENGTH = 2048;
  private static readonly ALGORITHM = 'RS256';

  /** Chave arbitraria e estavel do advisory lock que serializa o bootstrap. */
  private static readonly BOOTSTRAP_LOCK = 8_314_027_611;

  /** Por quanto tempo uma chave aposentada continua no JWKS. */
  private static readonly RETIRED_GRACE_MS = 24 * 60 * 60 * 1000;

  private readonly logger = new Logger(SigningKeyService.name);
  private cached: ActiveSigningKey | null = null;

  constructor(
    private prisma: PrismaService,
    private keyEncryption: KeyEncryptionService,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.ensureActiveKey();
  }

  /** Chave que assina agora. O PEM decifrado fica so em memoria. */
  async getActiveKey(): Promise<ActiveSigningKey> {
    if (this.cached) return this.cached;

    const key = await this.prisma.signingKey.findFirstOrThrow({
      where: { status: KeyStatus.ACTIVE },
      orderBy: { createdAt: 'desc' },
    });

    this.cached = {
      kid: key.id,
      algorithm: key.algorithm,
      privateKeyPem: this.keyEncryption.open({
        cipher: key.privateKeyCipher,
        iv: key.privateKeyIv,
        authTag: key.privateKeyAuthTag,
      }),
    };

    return this.cached;
  }

  /**
   * Documento publico. Inclui ACTIVE, NEXT e as RETIRED dentro da janela de
   * graca, para que nenhum token ainda valido fique orfao de chave.
   */
  async getJwks(): Promise<Jwks> {
    const keys = await this.prisma.signingKey.findMany({
      where: {
        OR: [
          { status: { in: [KeyStatus.ACTIVE, KeyStatus.NEXT] } },
          {
            status: KeyStatus.RETIRED,
            retiredAt: {
              gte: new Date(Date.now() - SigningKeyService.RETIRED_GRACE_MS),
            },
          },
        ],
      },
      orderBy: { createdAt: 'desc' },
    });

    return {
      keys: keys.map((k) => this.toJwk(k.id, k.publicKeyPem, k.algorithm)),
    };
  }

  /**
   * Chave publica de um `kid`, para verificar um token que este servidor
   * emitiu. Devolve null para `kid` desconhecido.
   *
   * Aceita tambem chave RETIRED: um token assinado por ela pode continuar em
   * circulacao dentro da propria validade, e recusa-lo aqui derrubaria
   * verificacao legitima durante a rotacao.
   */
  async publicKeyFor(kid: string): Promise<string | null> {
    const key = await this.prisma.signingKey.findUnique({ where: { id: kid } });

    return key?.publicKeyPem ?? null;
  }
  /**
   * Gera uma chave nova, promove a ACTIVE e aposenta a anterior.
   * A anterior continua no JWKS pela janela de graca.
   */
  async rotate(): Promise<{ kid: string }> {
    const { publicKeyPem, privateKeyPem } = this.generateKeyPair();
    const sealed = this.keyEncryption.seal(privateKeyPem);

    const created = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${SigningKeyService.BOOTSTRAP_LOCK})`;

      await tx.signingKey.updateMany({
        where: { status: KeyStatus.ACTIVE },
        data: { status: KeyStatus.RETIRED, retiredAt: new Date() },
      });

      return tx.signingKey.create({
        data: {
          algorithm: SigningKeyService.ALGORITHM,
          publicKeyPem,
          privateKeyCipher: sealed.cipher,
          privateKeyIv: sealed.iv,
          privateKeyAuthTag: sealed.authTag,
          status: KeyStatus.ACTIVE,
        },
      });
    });

    this.cached = null;
    this.logger.log(`Chave de assinatura rotacionada. Novo kid: ${created.id}`);

    return { kid: created.id };
  }

  /**
   * Cria a primeira chave se a tabela estiver vazia.
   * O advisory lock evita que duas replicas subindo juntas criem duas ACTIVE.
   */
  private async ensureActiveKey(): Promise<void> {
    const created = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${SigningKeyService.BOOTSTRAP_LOCK})`;

      const active = await tx.signingKey.findFirst({
        where: { status: KeyStatus.ACTIVE },
      });

      if (active) return null;

      const { publicKeyPem, privateKeyPem } = this.generateKeyPair();
      const sealed = this.keyEncryption.seal(privateKeyPem);

      return tx.signingKey.create({
        data: {
          algorithm: SigningKeyService.ALGORITHM,
          publicKeyPem,
          privateKeyCipher: sealed.cipher,
          privateKeyIv: sealed.iv,
          privateKeyAuthTag: sealed.authTag,
          status: KeyStatus.ACTIVE,
        },
      });
    });

    if (created) {
      this.logger.log(`Chave de assinatura inicial criada. kid: ${created.id}`);
    }
  }

  private generateKeyPair(): {
    publicKeyPem: string;
    privateKeyPem: string;
  } {
    const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
      modulusLength: SigningKeyService.MODULUS_LENGTH,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });

    return { publicKeyPem: publicKey, privateKeyPem: privateKey };
  }

  private toJwk(kid: string, publicKeyPem: string, algorithm: string): Jwk {
    const jwk = crypto
      .createPublicKey(publicKeyPem)
      .export({ format: 'jwk' }) as { kty: string; n: string; e: string };

    return {
      kty: jwk.kty,
      n: jwk.n,
      e: jwk.e,
      kid,
      use: 'sig',
      alg: algorithm,
    };
  }
}
