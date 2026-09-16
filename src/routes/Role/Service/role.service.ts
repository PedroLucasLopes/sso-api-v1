import { Injectable, NotFoundException } from '@nestjs/common';
import { Role } from 'generated/prisma/client';
import { PaginationConfig } from 'src/global/pagination/pagination';
import { PrismaService } from 'src/global/prisma/prisma.service';
import { AdminIdentity } from 'src/global/access/adminIdentity.dto';
import {
  assertNotRootRole,
  assertSelfWriter,
} from 'src/global/access/selfProjectProtection';
import { EditRole } from '../dto/editRole.dto';
import { CreateRole } from '../dto/createRole.dto';
import { FilterRole } from '../dto/filterRole.dto';

@Injectable()
export class RoleService {
  constructor(private prisma: PrismaService) {}

  async findAll(filter: FilterRole): Promise<Role[]> {
    const { page, limit } = PaginationConfig(filter);
    const roles = await this.prisma.role.findMany({
      where: {
        ...(filter?.name && {
          name: filter.name,
        }),
      },
      ...(filter?.order && {
        orderBy: { name: filter.order },
      }),
      include: {
        permissions: {
          select: {
            route: true,
          },
        },
      },
      skip: page,
      take: limit,
    });

    if (!roles.length) {
      throw new NotFoundException('No roles found');
    }

    return roles;
  }

  async findById(id: string): Promise<Role> {
    const role = await this.prisma.role.findUnique({
      where: { id },
      include: {
        permissions: {
          select: {
            route: true,
          },
        },
      },
    });

    if (!role) {
      throw new NotFoundException('Role not found');
    }

    return role;
  }

  /** Papel novo nasce vazio: o que ele alcanca e marcado depois, rota por rota. */
  async createRole(data: CreateRole, admin: AdminIdentity): Promise<Role> {
    const findProject = await this.prisma.project.findUnique({
      where: { id: data.projectId },
    });

    if (!findProject) {
      throw new NotFoundException('Project Not Found');
    }

    await assertSelfWriter(this.prisma, admin, data.projectId);

    const createRole = this.prisma.role.create({ data });

    return createRole;
  }

  async updateRole(
    id: string,
    data: EditRole,
    admin: AdminIdentity,
  ): Promise<Role> {
    const findRole = await this.prisma.role.findUnique({ where: { id } });

    if (!findRole) {
      throw new NotFoundException('Role not Found');
    }

    await assertSelfWriter(
      this.prisma,
      admin,
      findRole.projectId,
      data.projectId,
    );

    const renames = data.name !== undefined && data.name !== findRole.name;
    const moves =
      data.projectId !== undefined && data.projectId !== findRole.projectId;

    if (renames || moves) {
      await assertNotRootRole(this.prisma, findRole);
    }

    const updateRole = await this.prisma.role.update({ where: { id }, data });

    return updateRole;
  }

  async deleteRole(id: string, admin: AdminIdentity): Promise<void> {
    const findRole = await this.prisma.role.findUnique({ where: { id } });

    if (!findRole) {
      throw new NotFoundException('Role not found');
    }

    await assertSelfWriter(this.prisma, admin, findRole.projectId);
    await assertNotRootRole(this.prisma, findRole);

    await this.prisma.role.delete({ where: { id } });
  }
}
