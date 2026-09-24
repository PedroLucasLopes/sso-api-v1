import { Injectable } from '@nestjs/common';
import { Permission } from 'generated/prisma/client';
import { PrismaService } from 'src/global/prisma/prisma.service';
import { AdminIdentity } from 'src/global/access/adminIdentity.dto';
import { assertSelfWriter } from 'src/global/access/selfProjectProtection';
import { CreatePermission } from '../dto/createPermission.dto';
import { ApiException } from 'src/global/error/apiError';

@Injectable()
export class PermissionService {
  constructor(private prisma: PrismaService) {}

  async createPermission(
    data: CreatePermission,
    admin: AdminIdentity,
  ): Promise<Permission> {
    const { roleId, routeId } = data;

    const [role, route] = await Promise.all([
      this.prisma.role.findUnique({ where: { id: roleId } }),
      this.prisma.route.findUnique({ where: { id: routeId } }),
    ]);

    if (!role) {
      throw new ApiException('role_not_found');
    }

    if (!route) {
      throw new ApiException('route_not_found');
    }

    if (role.projectId !== route.projectId) {
      throw new ApiException('role_route_project_mismatch');
    }

    await assertSelfWriter(this.prisma, admin, role.projectId);

    const createPermission = await this.prisma.permission.create({
      data: { roleId, routeId },
    });

    return createPermission;
  }

  async deletePermission(id: string, admin: AdminIdentity): Promise<void> {
    const permission = await this.prisma.permission.findUnique({
      where: { id },
      include: { role: { select: { projectId: true } } },
    });

    if (!permission) {
      throw new ApiException('permission_not_found');
    }

    await assertSelfWriter(this.prisma, admin, permission.role.projectId);

    await this.prisma.permission.delete({ where: { id } });
  }
}
