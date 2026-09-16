import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Permission } from 'generated/prisma/client';
import { PrismaService } from 'src/global/prisma/prisma.service';
import { AdminIdentity } from 'src/global/access/adminIdentity.dto';
import { assertSelfWriter } from 'src/global/access/selfProjectProtection';
import { CreatePermission } from '../dto/createPermission.dto';

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
      throw new NotFoundException('Role not found');
    }

    if (!route) {
      throw new NotFoundException('Route not found');
    }

    if (role.projectId !== route.projectId) {
      throw new BadRequestException(
        'You cannot associate roles from different projects',
      );
    }

    await assertSelfWriter(this.prisma, admin, role.projectId);

    const createPermission = await this.prisma.permission.create({
      data: { roleId, routeId },
    });

    return createPermission;
  }

  /**
   * Busca antes de apagar: e o que da o 404 certo, e o que diz de qual projeto
   * a permissao e. O `delete` direto estourava P2025 antes de chegar ao `if`.
   */
  async deletePermission(id: string, admin: AdminIdentity): Promise<void> {
    const permission = await this.prisma.permission.findUnique({
      where: { id },
      include: { role: { select: { projectId: true } } },
    });

    if (!permission) {
      throw new NotFoundException('Permission not found');
    }

    await assertSelfWriter(this.prisma, admin, permission.role.projectId);

    await this.prisma.permission.delete({ where: { id } });
  }
}
