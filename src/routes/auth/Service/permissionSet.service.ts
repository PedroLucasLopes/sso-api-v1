import { Injectable, NotFoundException } from '@nestjs/common';
import * as crypto from 'node:crypto';
import { PrismaService } from 'src/global/prisma/prisma.service';
import { PermissionSet } from '../dto/permissionSet.dto';

/**
 * Resolve o conjunto de permissoes de um papel dentro de um projeto.
 *
 * Existe porque o access token deixou de carregar a lista enumerada de rotas.
 * O token leva `roles` (RFC 9068 secao 2.2.3.1) e a aplicacao cliente vem
 * buscar aqui o que aquele papel libera, uma vez por papel, guardando em
 * cache pelo hash.
 *
 * O hash e a impressao digital do conjunto: mudou permissao do papel, muda o
 * hash, e o cache do cliente cai sozinho, sem TTL adivinhado e sem precisar
 * avisar ninguem.
 */
@Injectable()
export class PermissionSetService {
  constructor(private prisma: PrismaService) {}

  async forRole(projectId: string, role: string): Promise<PermissionSet> {
    const found = await this.prisma.role.findFirst({
      where: { projectId, name: role },
      include: { permissions: { include: { route: true } } },
    });

    if (!found) {
      throw new NotFoundException(`papel ${role} nao existe neste projeto`);
    }

    const permissions = found.permissions
      .map((p) => ({ path: p.route.path, method: p.route.method as string }))
      // Ordenacao estavel: sem ela o hash mudaria a cada consulta, porque a
      // ordem de linhas do Postgres nao e garantida.
      .sort((a, b) =>
        a.path === b.path
          ? a.method.localeCompare(b.method)
          : a.path.localeCompare(b.path),
      );

    return { role, hash: this.hashOf(permissions), permissions };
  }

  /** Curto de proposito: vai dentro do token, e 12 caracteres bastam aqui. */
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
