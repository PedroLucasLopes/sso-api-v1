import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import * as crypto from 'node:crypto';
import { Prisma } from '@prisma/client';

type ClientKey = Prisma.ClientKeyGetPayload<{}>;
import { PrismaService } from 'src/global/prisma/prisma.service';
import { AdminIdentity } from 'src/global/access/adminIdentity.dto';
import { assertSelfWriter } from 'src/global/access/selfProjectProtection';
import { CreateClientKey } from '../dto/createClientKey.dto';
import { GeneratedClientKey } from '../dto/generatedClientKey.dto';

/**
 * Cadastro das chaves publicas que cada aplicacao cliente usa para se
 * autenticar no token endpoint via `private_key_jwt` (RFC 7523 secao 2.2).
 *
 * Substitui o `clientSecret` que foi removido do schema. A diferenca pratica:
 * um dump deste banco nao permite se passar por nenhum cliente, porque so a
 * metade publica do par mora aqui.
 *
 * Chave do projeto `SSO` autentica o proprio SSO como cliente, entao so a raiz
 * cadastra, gera ou revoga uma.
 */
@Injectable()
export class ClientKeyService {
  constructor(private prisma: PrismaService) {}

  async findByProject(projectId: string): Promise<ClientKey[]> {
    const keys = await this.prisma.clientKey.findMany({
      where: { projectId },
      orderBy: { createdAt: 'desc' },
    });

    if (!keys.length) {
      throw new NotFoundException('Nenhuma chave cadastrada para este projeto');
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
      throw new NotFoundException('Project not found');
    }

    await assertSelfWriter(this.prisma, admin, data.projectId);

    // Rejeita PEM malformado antes de gravar: descobrir isso so na hora de
    // verificar uma asserção transformaria erro de cadastro em falha de login.
    let publicKey: crypto.KeyObject;

    try {
      publicKey = crypto.createPublicKey(data.publicKeyPem);
    } catch {
      throw new BadRequestException('publicKeyPem nao e uma chave valida');
    }

    if (publicKey.asymmetricKeyType !== 'rsa') {
      throw new BadRequestException('apenas chaves RSA sao aceitas (RS256)');
    }

    const modulusBits = publicKey.asymmetricKeyDetails?.modulusLength ?? 0;

    if (modulusBits < 2048) {
      throw new BadRequestException(
        'a chave RSA precisa ter ao menos 2048 bits',
      );
    }

    return this.prisma.clientKey.create({
      data: {
        projectId: data.projectId,
        publicKeyPem: data.publicKeyPem,
        expiresAt: data.expiresAt ? new Date(data.expiresAt) : null,
      },
    });
  }

  /**
   * Gera o par dentro do SSO e devolve a privada UMA UNICA VEZ.
   *
   * O SSO guarda so a metade publica. A privada existe apenas na memoria
   * desta requisicao e na resposta: nao vai para o banco, nao vai para log,
   * nao e associada a nada automaticamente. Quem administra copia da resposta
   * e entrega ao dono da aplicacao por canal seguro.
   *
   * Perdeu? Nao ha recuperacao. Revogue esta chave e gere outra.
   */
  async generateKeyPair(
    projectId: string,
    admin: AdminIdentity,
  ): Promise<GeneratedClientKey> {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
    });

    if (!project) {
      throw new NotFoundException('Project not found');
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

  /**
   * Revogacao e logica, nao fisica: manter a linha permite auditar qual chave
   * assinou o que antes de ser descartada.
   */
  async revoke(id: string, admin: AdminIdentity): Promise<void> {
    const key = await this.prisma.clientKey.findUnique({
      where: { id },
      select: { projectId: true, revokedAt: true },
    });

    if (!key || key.revokedAt) {
      throw new NotFoundException('Chave nao encontrada ou ja revogada');
    }

    await assertSelfWriter(this.prisma, admin, key.projectId);

    const { count } = await this.prisma.clientKey.updateMany({
      where: { id: { equals: id }, revokedAt: null },
      data: { revokedAt: new Date() },
    });

    if (count === 0) {
      throw new NotFoundException('Chave nao encontrada ou ja revogada');
    }
  }
}
