import { Injectable } from '@nestjs/common';
import * as crypto from 'node:crypto';
import { ClientKey } from 'generated/prisma/client';
import { PrismaService } from 'src/global/prisma/prisma.service';
import { AdminIdentity } from 'src/global/access/adminIdentity.dto';
import { assertSelfWriter } from 'src/global/access/selfProjectProtection';
import { CreateClientKey } from '../dto/createClientKey.dto';
import { GeneratedClientKey } from '../dto/generatedClientKey.dto';
import { ApiException } from 'src/global/error/apiError';

@Injectable()
export class ClientKeyService {
  constructor(private prisma: PrismaService) {}

  async findByProject(projectId: string): Promise<ClientKey[]> {
    const keys = await this.prisma.clientKey.findMany({
      where: { projectId },
      orderBy: { createdAt: 'desc' },
    });

    if (!keys.length) {
      throw new ApiException('client_keys_empty');
    }

    return keys;
  }

  async create(
    data: CreateClientKey,
    admin: AdminIdentity,
  ): Promise<ClientKey> {
    const project = await this.prisma.project.findUnique({
      where: { id: data.projectId },
    });

    if (!project) {
      throw new ApiException('project_not_found');
    }

    await assertSelfWriter(this.prisma, admin, data.projectId);

    let publicKey: crypto.KeyObject;

    try {
      publicKey = crypto.createPublicKey(data.publicKeyPem);
    } catch {
      throw new ApiException('public_key_invalid');
    }

    if (publicKey.asymmetricKeyType !== 'rsa') {
      throw new ApiException('public_key_not_rsa');
    }

    const modulusBits = publicKey.asymmetricKeyDetails?.modulusLength ?? 0;

    if (modulusBits < 2048) {
      throw new ApiException('public_key_too_short');
    }

    return this.prisma.clientKey.create({
      data: {
        projectId: data.projectId,
        publicKeyPem: data.publicKeyPem,
        expiresAt: data.expiresAt ? new Date(data.expiresAt) : null,
      },
    });
  }

  async generateKeyPair(
    projectId: string,
    admin: AdminIdentity,
  ): Promise<GeneratedClientKey> {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
    });

    if (!project) {
      throw new ApiException('project_not_found');
    }

    await assertSelfWriter(this.prisma, admin, projectId);

    const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });

    const stored = await this.prisma.clientKey.create({
      data: { projectId, publicKeyPem: publicKey },
    });

    return {
      id: stored.id,
      projectId,
      publicKeyPem: publicKey,
      privateKeyBase64: Buffer.from(privateKey).toString('base64'),
      warning:
        'A chave privada aparece uma unica vez e nao fica guardada no SSO. ' +
        'Copie agora, entregue ao dono da aplicacao por canal seguro e limpe ' +
        'o historico. Se ela passar por chat, ticket, commit ou log de CI, ' +
        'revogue esta chave e gere outra.',
    };
  }

  async revoke(id: string, admin: AdminIdentity): Promise<void> {
    const key = await this.prisma.clientKey.findUnique({
      where: { id },
      select: { projectId: true, revokedAt: true },
    });

    if (!key || key.revokedAt) {
      throw new ApiException('client_key_not_found');
    }

    await assertSelfWriter(this.prisma, admin, key.projectId);

    const { count } = await this.prisma.clientKey.updateMany({
      where: { id, revokedAt: null },
      data: { revokedAt: new Date() },
    });

    if (count === 0) {
      throw new ApiException('client_key_not_found');
    }
  }
}
