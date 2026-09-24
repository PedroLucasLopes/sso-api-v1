import { ForbiddenException } from '@nestjs/common';
import {
  SSO_ROOT_ROLE,
  SSO_SELF_PROJECT_NAME,
} from '../constants/selfProject.constant';
import { PrismaService } from '../prisma/prisma.service';
import { AdminIdentity } from './adminIdentity.dto';

export const SELF_PROJECT_PROTECTED = 'sso_project_protected';

export const LAST_SUPERADMIN = 'sso_last_superadmin';

export const SELF_WRITER_MESSAGE =
  'rotas, papeis, permissoes, membros, redirect URIs e chaves do projeto SSO so o SUPERADMIN altera';

export function selfProjectProtected(message: string): ForbiddenException {
  return new ForbiddenException({ error: SELF_PROJECT_PROTECTED, message });
}

export async function isSelfProject(
  prisma: PrismaService,
  projectId: string | undefined,
): Promise<boolean> {
  if (!projectId) return false;

  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { name: true },
  });

  return project?.name === SSO_SELF_PROJECT_NAME;
}

export async function assertSelfWriter(
  prisma: PrismaService,
  admin: AdminIdentity,
  ...projectIds: (string | undefined)[]
): Promise<void> {
  if (admin.root) return;

  for (const projectId of projectIds) {
    if (await isSelfProject(prisma, projectId)) {
      throw selfProjectProtected(SELF_WRITER_MESSAGE);
    }
  }
}

export async function assertNotRootRole(
  prisma: PrismaService,
  role: { name: string; projectId: string },
): Promise<void> {
  if (
    role.name === SSO_ROOT_ROLE &&
    (await isSelfProject(prisma, role.projectId))
  ) {
    throw selfProjectProtected(
      'o papel SUPERADMIN do projeto SSO e a raiz: nao se renomeia nem se apaga',
    );
  }
}

export async function assertKeepsRoot(
  prisma: PrismaService,
  membership: { userId: string; projectId: string; roleName: string },
  nextRoleName?: string,
): Promise<void> {
  if (membership.roleName !== SSO_ROOT_ROLE) return;
  if (nextRoleName === SSO_ROOT_ROLE) return;
  if (!(await isSelfProject(prisma, membership.projectId))) return;

  const others = await prisma.projectUser.count({
    where: {
      projectId: membership.projectId,
      role: { name: SSO_ROOT_ROLE },
      userId: { not: membership.userId },
    },
  });

  if (others === 0) {
    throw new ForbiddenException({
      error: LAST_SUPERADMIN,
      message: 'o projeto SSO precisa de ao menos um SUPERADMIN',
    });
  }
}
