import { Injectable, Logger } from '@nestjs/common';
import {
  acceptsSignup,
  enteringRole,
  PROJECT_ACCESS_POLICY_FIELDS,
  ProjectAccessPolicy,
  secondFactorOptional,
} from 'src/global/access/projectPolicy';
import { SSO_SELF_PROJECT_NAME } from 'src/global/constants/selfProject.constant';
import { PrismaService } from 'src/global/prisma/prisma.service';

export interface ProjectEntry {
  roleId: string | null;
  secondFactorRequired: boolean;
}

@Injectable()
export class ProjectEntryService {
  private readonly logger = new Logger(ProjectEntryService.name);

  constructor(private readonly prisma: PrismaService) {}

  async policy(projectId: string): Promise<ProjectAccessPolicy | null> {
    return this.prisma.project.findUnique({
      where: { id: projectId },
      select: PROJECT_ACCESS_POLICY_FIELDS,
    });
  }

  async assess(
    userId: string,
    project: ProjectAccessPolicy,
  ): Promise<ProjectEntry> {
    const membership = await this.membershipRole(userId, project.id);
    const roleId = enteringRole(
      project,
      membership,
      !membership && (await this.blocked(userId, project.id)),
    );

    return {
      roleId,
      secondFactorRequired: await this.secondFactorRequired(
        userId,
        project,
        roleId,
      ),
    };
  }

  async secondFactorRequired(
    userId: string,
    project: ProjectAccessPolicy,
    roleId: string | null,
  ): Promise<boolean> {
    if (!secondFactorOptional(project, roleId)) return true;

    const ssoRoles = await this.prisma.projectUser.count({
      where: { userId, project: { name: SSO_SELF_PROJECT_NAME } },
    });

    return ssoRoles > 0;
  }

  async enter(userId: string, projectId: string): Promise<string | null> {
    const membership = await this.membershipRole(userId, projectId);

    if (membership) return membership;

    const project = await this.policy(projectId);

    if (!project || !acceptsSignup(project) || !project.defaultRoleId) {
      return null;
    }

    if (await this.blocked(userId, projectId)) {
      this.logger.log(
        `conta ${userId} foi tirada do projeto ${project.name} e nao volta pelo papel padrao`,
      );

      return null;
    }

    await this.prisma.projectUser.createMany({
      data: [{ userId, projectId, roleId: project.defaultRoleId }],
      skipDuplicates: true,
    });

    this.logger.log(
      `conta ${userId} entrou no projeto ${project.name} com o papel padrao`,
    );

    return this.membershipRole(userId, projectId);
  }

  private async membershipRole(
    userId: string,
    projectId: string,
  ): Promise<string | null> {
    const membership = await this.prisma.projectUser.findUnique({
      where: { userId_projectId: { userId, projectId } },
      select: { roleId: true },
    });

    return membership?.roleId ?? null;
  }

  private async blocked(userId: string, projectId: string): Promise<boolean> {
    const block = await this.prisma.projectBlock.findUnique({
      where: { userId_projectId: { userId, projectId } },
      select: { userId: true },
    });

    return block !== null;
  }
}
