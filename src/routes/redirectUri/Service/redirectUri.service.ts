import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { redirectUri } from 'generated/prisma/client';
import { PrismaService } from 'src/global/prisma/prisma.service';
import { SSO_SELF_PROJECT_NAME } from 'src/global/constants/selfProject.constant';
import { AdminIdentity } from 'src/global/access/adminIdentity.dto';
import {
  assertSelfWriter,
  isSelfProject,
  SELF_WRITER_MESSAGE,
  selfProjectProtected,
} from 'src/global/access/selfProjectProtection';
import { CreateRedirectUri } from '../dto/createRedirectUri.dto';
import { EditRedirectUri } from '../dto/editRedirectUri.dto';

@Injectable()
export class RedirectUriService {
  constructor(private prisma: PrismaService) {}

  /**
   * No projeto `SSO`, uma redirect URI tambem e origem que pode escrever pela
   * sessao do console. Por isso cadastrar ali e coisa da raiz.
   */
  async createRedirectUri(
    data: CreateRedirectUri,
    admin: AdminIdentity,
  ): Promise<redirectUri> {
    const findProject = await this.prisma.project.findUnique({
      where: { id: data.projectId },
    });

    if (!findProject) {
      throw new NotFoundException('Project not found');
    }

    await assertSelfWriter(this.prisma, admin, data.projectId);

    const createRedirectUri = await this.prisma.redirectUri.create({
      data: {
        redirectUri: data.redirectUri,
        projectId: data.projectId,
      },
    });

    return createRedirectUri;
  }

  async updateRedirectUri(
    id: string,
    data: EditRedirectUri,
    admin: AdminIdentity,
  ): Promise<redirectUri> {
    const findRedirectUri = await this.prisma.redirectUri.findUnique({
      where: { id },
    });

    if (!findRedirectUri) {
      throw new NotFoundException('Redirect Uri not found');
    }

    /* Editar troca o endereco sem transicao: se for o do console, ele perde o
     * login no mesmo instante. No SSO cadastra-se o novo e apaga-se o antigo,
     * e a exclusao tem as travas certas. */
    if (await isSelfProject(this.prisma, findRedirectUri.projectId)) {
      throw selfProjectProtected(
        'no projeto SSO, redirect URI nao se edita: cadastre a nova e apague a antiga',
      );
    }

    if (data.projectId) {
      const findProject = await this.prisma.project.findUnique({
        where: { id: data.projectId },
      });

      if (!findProject) {
        throw new NotFoundException('Project not found');
      }
    }

    await assertSelfWriter(this.prisma, admin, data.projectId);

    const updateRedirectUri = await this.prisma.redirectUri.update({
      where: { id },
      data,
    });

    return updateRedirectUri;
  }

  /**
   * Tira o endereco de circulacao. O authorize deixa de aceita-lo na hora, e o
   * token endpoint recusa code emitido para ele antes da exclusao.
   *
   * No projeto do proprio SSO sao estas URIs que deixam o console entrar. So a
   * raiz apaga, e ainda com duas travas: a ultima nao sai, e ninguem apaga a da
   * origem de onde esta pedindo. `origin` e o header da requisicao; a linha de
   * comando nao o manda.
   */
  async deleteRedirectUri(
    id: string,
    admin: AdminIdentity,
    origin?: string,
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const record = await tx.redirectUri.findUnique({
        where: { id },
        include: { project: { select: { name: true } } },
      });

      if (!record) {
        throw new NotFoundException('Redirect Uri not found');
      }

      if (record.project.name === SSO_SELF_PROJECT_NAME) {
        if (!admin.root) {
          throw selfProjectProtected(SELF_WRITER_MESSAGE);
        }

        // Serializa as exclusoes do projeto: duas pessoas apagando as duas
        // ultimas URIs ao mesmo tempo nao deixam o console sem nenhuma.
        await tx.$executeRaw`SELECT id FROM "Project" WHERE id = ${record.projectId} FOR UPDATE`;

        const total = await tx.redirectUri.count({
          where: { projectId: record.projectId },
        });

        if (total <= 1) {
          throw new ForbiddenException({
            error: 'sso_redirect_uri_last',
            message: 'o projeto SSO precisa de ao menos uma redirect URI',
          });
        }

        if (origin && originOf(record.redirectUri) === origin) {
          throw new ForbiddenException({
            error: 'sso_redirect_uri_in_use',
            message: 'esta redirect URI e a do console que fez o pedido',
          });
        }
      }

      /* `deleteMany` com contagem: duas exclusoes simultaneas da mesma URI
       * terminam em 204 e 404, sem P2025 no meio. */
      const { count } = await tx.redirectUri.deleteMany({ where: { id } });

      if (count === 0) {
        throw new NotFoundException('Redirect Uri not found');
      }
    });
  }
}

function originOf(uri: string): string | null {
  try {
    return new URL(uri).origin;
  } catch {
    return null;
  }
}
