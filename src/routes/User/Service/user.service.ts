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

  async deleteUser(id: string): Promise<void> {
    const outcome = await this.prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<
        { id: string }[]
      >`SELECT id FROM "User" WHERE id = ${id} FOR UPDATE`;

      if (locked.length === 0) return 'not_found' as const;

      const memberships = await tx.projectUser.count({ where: { userId: id } });

      if (memberships > 0) return 'has_projects' as const;

      const sessions = await tx.$queryRaw<
        { id: string }[]
      >`SELECT id FROM "AuthSession" WHERE "userId" = ${id} FOR UPDATE`;
      const sessionIds = sessions.map((session) => session.id);

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
