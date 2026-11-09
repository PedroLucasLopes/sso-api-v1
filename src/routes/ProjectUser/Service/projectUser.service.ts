import { Injectable } from '@nestjs/common';
import { PrismaService } from 'src/global/prisma/prisma.service';
import { AdminIdentity } from 'src/global/access/adminIdentity.dto';
import {
  assertKeepsRoot,
  assertSelfWriter,
} from 'src/global/access/selfProjectProtection';
import { CreateProjectUser } from '../dto/createProjectUser.dto';
import { EditProjectUser } from '../dto/editProjectUser.dto';
import { ProjectUser } from 'generated/prisma/client';
import { ApiException } from 'src/global/error/apiError';

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
      throw new ApiException('user_not_found');
    }

    if (!project) {
      throw new ApiException('project_not_found');
    }

    if (!role) {
      throw new ApiException('role_not_found');
    }

    if (project.id !== role.projectId) {
      throw new ApiException('role_not_in_project');
    }

    await assertSelfWriter(this.prisma, admin, projectId);

    const createProjectUser = this.prisma.projectUser.create({
      data: { userId, projectId, roleId },
    });

    return createProjectUser;
  }

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
      throw new ApiException('member_not_found');
    }

    const role = await this.prisma.role.findUnique({
      where: { id: data.roleId },
    });

    if (!role) {
      throw new ApiException('role_not_found');
    }

    if (role.projectId !== projectId) {
      throw new ApiException('role_not_in_project');
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
      throw new ApiException('member_not_found');
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
