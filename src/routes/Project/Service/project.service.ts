import { Injectable } from '@nestjs/common';
import { Project } from 'generated/prisma/client';
import { MfaPolicy, ProjectStatus, SignupPolicy } from 'generated/prisma/enums';
import { ProjectOverview, SetProjectPolicy } from '../dto/projectOverview.dto';
import { PaginationConfig } from 'src/global/pagination/pagination';
import { PrismaService } from 'src/global/prisma/prisma.service';
import { SSO_SELF_PROJECT_NAME } from 'src/global/constants/selfProject.constant';
import { DEFAULT_ROLE_NAMES } from 'src/global/constants/defaultRoles.constant';
import { AdminIdentity } from 'src/global/access/adminIdentity.dto';
import {
  assertSelfProjectPolicy,
  selfProjectProtected,
} from 'src/global/access/selfProjectProtection';
import { CreateProject } from '../dto/createProject.dto';
import { FilterProject } from '../dto/filterProject.dto';
import { EditProject } from '../dto/editProject.dto';
import { logoProblem } from '../logo';
import * as crypto from 'node:crypto';
import { ApiException } from 'src/global/error/apiError';

export type ProjectListing = Omit<Project, 'logo'>;

@Injectable()
export class ProjectService {
  constructor(private prisma: PrismaService) {}

  async findAll(filter: FilterProject): Promise<ProjectListing[]> {
    const { page, limit } = PaginationConfig(filter);
    const projects = await this.prisma.project.findMany({
      where: {
        ...(filter?.name && {
          name: { contains: filter.name, mode: 'insensitive' },
        }),
      },
      ...(filter?.order && {
        orderBy: { name: filter.order },
      }),
      include: {
        projectUsers: true,
      },
      omit: { logo: true },
      skip: page,
      take: limit,
    });

    if (!projects.length) {
      throw new ApiException('no_results');
    }

    return projects;
  }

  async findById(id: string): Promise<Project> {
    const project = await this.prisma.project.findUnique({ where: { id } });

    if (!project) {
      throw new ApiException('project_not_found');
    }

    return project;
  }

  async createProject(data: CreateProject): Promise<Project> {
    const clientId = crypto.randomBytes(32).toString('hex');

    return this.prisma.project.create({
      data: {
        ...data,
        clientId,
        roles: { create: DEFAULT_ROLE_NAMES.map((name) => ({ name })) },
      },
    });
  }

  async updateProject(id: string, data: EditProject): Promise<Project> {
    const project = await this.prisma.project.findUnique({ where: { id } });

    if (!project) {
      throw new ApiException('project_not_found');
    }

    if (project.name === SSO_SELF_PROJECT_NAME) {
      throw selfProjectProtected(
        'o projeto SSO nao pode ser renomeado: o proprio SSO se encontra por este nome',
      );
    }

    const displayName =
      data.displayName === undefined
        ? undefined
        : data.displayName?.trim() || null;

    const logo = data.logo === undefined ? undefined : data.logo || null;

    if (logo) {
      const problem = logoProblem(logo);

      if (problem) throw new ApiException(problem);
    }

    const editProject = await this.prisma.project.update({
      where: { id },
      data: { name: data.name, displayName, logo },
    });

    return editProject;
  }

  async setPolicy(
    id: string,
    data: SetProjectPolicy,
    admin: AdminIdentity,
  ): Promise<Project> {
    if (!admin.root) {
      throw new ApiException('project_policy_root_only');
    }

    const project = await this.prisma.project.findUnique({ where: { id } });

    if (!project) {
      throw new ApiException('project_not_found');
    }

    const policy = {
      signupPolicy: data.signupPolicy,
      mfaPolicy: data.mfaPolicy,
      defaultRoleId: data.defaultRoleId ?? null,
    };

    assertSelfProjectPolicy(project, policy);

    const needsDefaultRole =
      policy.signupPolicy === SignupPolicy.OPEN ||
      policy.mfaPolicy === MfaPolicy.OPTIONAL;

    if (needsDefaultRole && !policy.defaultRoleId) {
      throw new ApiException('default_role_required');
    }

    if (policy.defaultRoleId) {
      const role = await this.prisma.role.findUnique({
        where: { id: policy.defaultRoleId },
        select: { projectId: true },
      });

      if (!role) {
        throw new ApiException('role_not_found');
      }

      if (role.projectId !== id) {
        throw new ApiException('role_not_in_project');
      }
    }

    return this.prisma.project.update({ where: { id }, data: policy });
  }

  async setStatus(id: string, status: ProjectStatus): Promise<Project> {
    const project = await this.prisma.project.findUnique({ where: { id } });

    if (!project) {
      throw new ApiException('project_not_found');
    }

    if (
      project.name === SSO_SELF_PROJECT_NAME &&
      status !== ProjectStatus.ACTIVE
    ) {
      throw selfProjectProtected(
        'o projeto SSO nao sai de ACTIVE: fora dele, ninguem administra o SSO',
      );
    }

    if (status === ProjectStatus.ACTIVE) {
      const keys = await this.prisma.clientKey.count({
        where: { projectId: id, revokedAt: null },
      });

      if (keys === 0) {
        throw new ApiException('client_key_required');
      }
    }

    return this.prisma.project.update({
      where: { id },
      data: {
        status,
        ...(status === ProjectStatus.ACTIVE && { activatedAt: new Date() }),
        ...(status === ProjectStatus.SUSPENDED && { suspendedAt: new Date() }),
      },
    });
  }

  async overview(id: string): Promise<ProjectOverview> {
    const project = await this.prisma.project.findUnique({
      where: { id },
      include: {
        redirectUris: true,
        clientKeys: true,
        routes: { orderBy: [{ path: 'asc' }, { method: 'asc' }] },
        roles: {
          include: { permissions: { include: { route: true } } },
          orderBy: { name: 'asc' },
        },
        projectUsers: {
          include: {
            user: true,
            role: { include: { _count: { select: { permissions: true } } } },
          },
        },
      },
    });

    if (!project) {
      throw new ApiException('project_not_found');
    }

    return {
      id: project.id,
      name: project.name,
      status: project.status,
      clientId: project.clientId,
      createdAt: project.createdAt,
      activatedAt: project.activatedAt,
      suspendedAt: project.suspendedAt,
      signupPolicy: project.signupPolicy,
      mfaPolicy: project.mfaPolicy,
      defaultRoleId: project.defaultRoleId,
      displayName: project.displayName,
      logo: project.logo,
      redirectUris: project.redirectUris.map((r) => r.redirectUri),
      redirectUriRecords: project.redirectUris.map((r) => ({
        id: r.id,
        redirectUri: r.redirectUri,
      })),
      clientKeys: project.clientKeys.map((k) => ({
        id: k.id,
        createdAt: k.createdAt,
        expiresAt: k.expiresAt,
        revokedAt: k.revokedAt,
      })),
      routes: project.routes.map((r) => ({
        id: r.id,
        method: r.method,
        path: r.path,
      })),
      roles: project.roles.map((role) => ({
        id: role.id,
        name: role.name,
        permissions: role.permissions.map((p) => ({
          id: p.id,
          routeId: p.routeId,
          method: p.route.method,
          path: p.route.path,
        })),
      })),
      users: project.projectUsers.map((pu) => ({
        id: pu.user.id,
        name: pu.user.name,
        email: pu.user.email,
        role: pu.role.name,
        grantedRoutes: pu.role._count.permissions,
      })),
    };
  }

  async deleteProject(id: string): Promise<void> {
    const project = await this.prisma.project.findUnique({
      where: { id },
      include: { projectUsers: true, routes: true },
    });

    if (!project) {
      throw new ApiException('project_not_found');
    }

    if (project.name === SSO_SELF_PROJECT_NAME) {
      throw selfProjectProtected(
        'o projeto SSO nao pode ser apagado: e ele que administra todas as aplicacoes',
      );
    }

    if (project.projectUsers.length > 0) {
      throw new ApiException('project_has_members');
    }

    if (project.routes.length > 0) {
      throw new ApiException('project_has_routes');
    }

    await this.prisma.$transaction([
      this.prisma.role.deleteMany({ where: { projectId: id } }),
      this.prisma.redirectUri.deleteMany({ where: { projectId: id } }),
      this.prisma.clientKey.deleteMany({ where: { projectId: id } }),
      this.prisma.project.delete({ where: { id } }),
    ]);
  }
}
