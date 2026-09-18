import { Injectable } from '@nestjs/common';
import { User } from 'generated/prisma/client';
import { PaginationConfig } from 'src/global/pagination/pagination';
import { PrismaService } from 'src/global/prisma/prisma.service';
import { FilterUser } from '../dto/filterUser.dto';
import { CreateUser } from '../dto/createUser.dto';
import { EditUser } from '../dto/editUser.dto';
import { ApiException } from 'src/global/error/apiError';

@Injectable()
export class UserService {
  constructor(private prisma: PrismaService) {}

  async findAll(filter: FilterUser): Promise<User[]> {
    const { page, limit } = PaginationConfig(filter);
    const users = await this.prisma.user.findMany({
      where: {
        ...(filter?.name && {
          name: { contains: filter.name, mode: 'insensitive' },
        }),
        ...(filter?.email && {
          email: { contains: filter.email, mode: 'insensitive' },
        }),
      },
      ...(filter?.order && {
        orderBy: { name: filter.order },
      }),
      include: {
        projectUsers: {
          select: {
            project: true,
            role: {
              select: {
                permissions: {
                  select: { route: { select: { path: true, method: true } } },
                },
              },
            },
          },
        },
      },
      skip: page,
      take: limit,
    });

    if (!users.length) {
      throw new ApiException('no_results');
    }

    return users;
  }

  async findById(id: string): Promise<User> {
    const user = await this.prisma.user.findUnique({
      where: { id },
      include: {
        projectUsers: {
          select: {
            user: true,
            project: true,
            role: true,
          },
        },
      },
    });

    if (!user) {
      throw new ApiException('user_not_found');
    }

    return user;
  }

  async createUser(data: CreateUser): Promise<User> {
    const createUser = this.prisma.user.create({ data });

    return createUser;
  }

  async updateUser(id: string, data: EditUser): Promise<User> {
    const user = await this.prisma.user.findUnique({ where: { id } });

    if (!user) {
      throw new ApiException('user_not_found');
    }

    const editUser = await this.prisma.user.update({
      where: { id },
      data,
    });

    return editUser;
  }

  /**
   * Apaga a pessoa, e com ela o rastro do login dela.
   *
   * O vinculo com projeto continua barrando: tirar alguem de um projeto e
   * decisao de quem administra aquele projeto, e some da lista de membros dele.
   * O que sobra depois que ela nao tem mais nenhum nao e acesso, e rastro: a
   * sessao dela com o SSO, os refresh tokens e os authorization codes. Nada
   * disso a deixava entrar em lugar nenhum, e mesmo assim impedia a exclusao,
   * porque a chave estrangeira de `AuthSession` recusava apagar o `User` e a
   * resposta virava 500.
   *
   * Agora sai tudo na mesma transacao, e apagar vale como revogar cada grant
   * (RFC 7009 secao 2.1): nenhuma aplicacao renova mais nada para ela, e a
   * sessao no proprio SSO morre junto. O access token ja emitido continua
   * verificando ate expirar, como sempre (RFC 10017 secao 6.2.4); sao 15
   * minutos, e quem chega aqui ja nao tinha papel em projeto nenhum.
   *
   * A linha da pessoa e as sessoes dela ficam travadas durante a conferencia.
   * Vincular alguem a um projeto e emitir refresh token conferem a chave
   * estrangeira contra essas linhas, entao o que comecar no meio espera a
   * transacao terminar e falha, em vez de ressuscitar parte do cadastro.
   */
  async deleteUser(id: string): Promise<void> {
    /* A decisao sai da transacao como resultado, e a excecao acontece fora:
     * lancar aqui dentro dispararia rollback, que e a armadilha ja paga na
     * revogacao por reuso de token. */
    const outcome = await this.prisma.$transaction(async (tx) => {
      const travada = await tx.$queryRaw<
        { id: string }[]
      >`SELECT id FROM "User" WHERE id = ${id} FOR UPDATE`;

      if (travada.length === 0) return 'not_found' as const;

      const vinculos = await tx.projectUser.count({ where: { userId: id } });

      if (vinculos > 0) return 'has_projects' as const;

      const sessoes = await tx.$queryRaw<
        { id: string }[]
      >`SELECT id FROM "AuthSession" WHERE "userId" = ${id} FOR UPDATE`;
      const sessionIds = sessoes.map((sessao) => sessao.id);

      await tx.authorizationCode.deleteMany({
        where: { OR: [{ userId: id }, { authSessionId: { in: sessionIds } }] },
      });
      await tx.refreshToken.deleteMany({
        where: { OR: [{ userId: id }, { authSessionId: { in: sessionIds } }] },
      });
      await tx.authSession.deleteMany({ where: { userId: id } });
      await tx.user.delete({ where: { id } });

      return 'deleted' as const;
    });

    if (outcome === 'not_found') {
      throw new ApiException('user_not_found');
    }

    if (outcome === 'has_projects') {
      throw new ApiException('user_has_projects');
    }
  }
}
