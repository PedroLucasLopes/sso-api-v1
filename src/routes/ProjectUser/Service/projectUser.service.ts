import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from 'src/global/prisma/prisma.service';
import { AdminIdentity } from 'src/global/access/adminIdentity.dto';
import {
  assertKeepsRoot,
  assertSelfWriter,
} from 'src/global/access/selfProjectProtection';
import { CreateProjectUser } from '../dto/createProjectUser.dto';
import { EditProjectUser } from '../dto/editProjectUser.dto';
import { ProjectUser } from 'generated/prisma/client';

/**
 * Quem tem acesso a cada projeto, e com qual papel. Um papel por pessoa por
 * projeto: trocar de papel substitui o anterior.
 *
 * No projeto `SSO`, vincular alguem e conceder poder administrativo, entao so
 * a raiz vincula, troca e remove. Antes disto, um ADMIN conseguia colocar
 * qualquer conta como SUPERADMIN.
 */
@Injectable()
export class ProjectUserService {
  constructor(private prisma: PrismaService) {}

  async createProjectUser(
    data: CreateProjectUser,
    admin: AdminIdentity,
  ): Promise<ProjectUser> {
    const { userId, projectId, roleId } = data;
    const [user, project, role] = await Promise.all([
      this.prisma.user.findUnique({ where: { id: userId } }),
      this.prisma.project.findUnique({ where: { id: projectId } }),
      this.prisma.role.findUnique({
        where: { id: roleId },
        include: { permissions: true },
      }),
    ]);

    if (!user) {
      throw new NotFoundException('User not found');
    }

    if (!project) {
      throw new NotFoundException('Project not found');
    }

    if (!role) {
      throw new NotFoundException('Role not found');
    }

    if (project.id !== role.projectId) {
      throw new BadRequestException(
        `${role.name} role does not exist in ${project.name} project`,
      );
    }

    await assertSelfWriter(this.prisma, admin, projectId);

    const createProjectUser = this.prisma.projectUser.create({
      data: { userId, projectId, roleId },
    });

    return createProjectUser;
  }

  /**
   * Troca o papel de quem ja e membro. O access token em circulacao continua
   * com o papel antigo ate renovar; a renovacao ja sai com o novo.
   */
  async changeRole(
    projectId: string,
    userId: string,
    data: EditProjectUser,
    admin: AdminIdentity,
  ): Promise<ProjectUser> {
    const membership = await this.prisma.projectUser.findUnique({
      where: { userId_projectId: { userId, projectId } },
      include: { role: { select: { name: true } } },
    });

    if (!membership) {
      throw new NotFoundException('Project user not found');
    }

    const role = await this.prisma.role.findUnique({
      where: { id: data.roleId },
    });

    if (!role) {
      throw new NotFoundException('Role not found');
    }

    if (role.projectId !== projectId) {
      throw new BadRequestException(
        `${role.name} role does not exist in this project`,
      );
    }

    await assertSelfWriter(this.prisma, admin, projectId);
    await assertKeepsRoot(
      this.prisma,
      { userId, projectId, roleName: membership.role.name },
      role.name,
    );

    return this.prisma.projectUser.update({
      where: { userId_projectId: { userId, projectId } },
      data: { roleId: role.id },
    });
  }

  /**
   * Tira a pessoa do projeto. Os refresh tokens dela neste projeto caem junto
   * do vinculo, entao a aplicacao nao renova mais nada para ela.
   */
  async removeMember(
    projectId: string,
    userId: string,
    admin: AdminIdentity,
  ): Promise<void> {
    const membership = await this.prisma.projectUser.findUnique({
      where: { userId_projectId: { userId, projectId } },
      include: { role: { select: { name: true } } },
    });

    if (!membership) {
      throw new NotFoundException('Project user not found');
    }

    await assertSelfWriter(this.prisma, admin, projectId);
    await assertKeepsRoot(this.prisma, {
      userId,
      projectId,
      roleName: membership.role.name,
    });

    await this.prisma.$transaction([
      this.prisma.refreshToken.updateMany({
        where: { userId, projectId, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
      this.prisma.projectUser.delete({
        where: { userId_projectId: { userId, projectId } },
      }),
    ]);
  }
}
