import { ForbiddenException } from '@nestjs/common';
import {
  SSO_ROOT_ROLE,
  SSO_SELF_PROJECT_NAME,
} from '../constants/selfProject.constant';
import { PrismaService } from '../prisma/prisma.service';
import { AdminIdentity } from './adminIdentity.dto';

/**
 * O projeto do proprio SSO e quem administra todas as aplicacoes. Apagar,
 * renomear ou suspender o projeto, ou mexer no que ele concede, muda quem
 * administra tudo. Por isso as regras moram no servidor e valem para qualquer
 * cliente: console, linha de comando ou script.
 *
 * - O projeto `SSO` nao se apaga, nao se renomeia e nao sai de ACTIVE, nem
 *   pela raiz.
 * - Rota, papel, permissao, membro, redirect URI e chave do `SSO` so a raiz
 *   altera. Conceder qualquer coisa ali e conceder poder administrativo, e um
 *   ADMIN que pudesse fazer isso se promoveria sozinho.
 * - O papel SUPERADMIN do `SSO` e a raiz: nao se renomeia nem se apaga.
 * - O `SSO` nunca fica sem um SUPERADMIN.
 *
 * Nas outras aplicacoes nada disso se aplica: quem tem a permissao da rota
 * cria papeis, marca permissoes e vincula pessoas livremente.
 *
 * 403 com codigo, e nao 404: quem recebe estas recusas ja tem permissao para a
 * rota, entao nao ha existencia a esconder. O codigo separa esta recusa das
 * outras.
 */
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

/**
 * Escrita que toca o projeto `SSO` exige a raiz. Recebe todos os projetos que a
 * escrita toca: o atual e, numa edicao, o de destino, para ninguem mover um
 * item para dentro do SSO.
 */
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

/** O papel raiz do `SSO` nao se renomeia nem se apaga, nem pela propria raiz. */
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

/**
 * Tirar alguem do `SSO`, ou trocar o papel de alguem ali, nao pode deixar o
 * projeto sem SUPERADMIN. Sem raiz, nenhuma rota nova volta a ser cadastrada.
 */
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
