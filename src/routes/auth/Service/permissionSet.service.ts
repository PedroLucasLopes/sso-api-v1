import { Injectable } from '@nestjs/common';
import * as crypto from 'node:crypto';
import { PrismaService } from 'src/global/prisma/prisma.service';
import { PermissionSet } from '../dto/permissionSet.dto';
import { ApiException } from 'src/global/error/apiError';

@Injectable()
export class PermissionSetService {
  constructor(private prisma: PrismaService) {}

  async forRole(projectId: string, role: string): Promise<PermissionSet> {
    const found = await this.prisma.role.findFirst({
      where: { projectId, name: role },
      include: { permissions: { include: { route: true } } },
    });

    if (!found) {
      throw new ApiException('role_not_found');
    }

    const permissions = found.permissions
      .map((p) => ({ path: p.route.path, method: p.route.method as string }))
      .sort((a, b) =>
        a.path === b.path
          ? a.method.localeCompare(b.method)
          : a.path.localeCompare(b.path),
      );

    return { role, hash: this.hashOf(permissions), permissions };
  }

  hashOf(permissions: Array<{ path: string; method: string }>): string {
    const canonical = permissions
      .map((p) => `${p.method} ${p.path}`)
      .join('\n');

    return crypto
      .createHash('sha256')
      .update(canonical)
      .digest('base64url')
      .slice(0, 12);
  }
}
