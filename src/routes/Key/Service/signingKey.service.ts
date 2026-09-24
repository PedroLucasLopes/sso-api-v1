import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import * as crypto from 'node:crypto';
import { KeyStatus } from 'generated/prisma/enums';
import { PrismaService } from 'src/global/prisma/prisma.service';
import { KeyEncryptionService } from 'src/global/crypto/keyEncryption.service';
import { ActiveSigningKey, Jwk, Jwks } from '../dto/jwks.dto';

@Injectable()
export class SigningKeyService implements OnModuleInit {
  private static readonly MODULUS_LENGTH = 2048;
  private static readonly ALGORITHM = 'RS256';

  private static readonly BOOTSTRAP_LOCK = 8_314_027_611;

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

  async publicKeyFor(kid: string): Promise<string | null> {
    const key = await this.prisma.signingKey.findUnique({ where: { id: kid } });

    return key?.publicKeyPem ?? null;
  }
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
