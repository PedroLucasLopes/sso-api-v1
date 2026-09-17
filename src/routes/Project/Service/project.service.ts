import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';

type Project = Prisma.ProjectGetPayload<{}>;
type ProjectStatus = Prisma.ProjectStatus;
import { ProjectOverview } from '../dto/projectOverview.dto';
import { PaginationConfig } from 'src/global/pagination/pagination';
import { PrismaService } from 'src/global/prisma/prisma.service';
import { SSO_SELF_PROJECT_NAME } from 'src/global/constants/selfProject.constant';
import { DEFAULT_ROLE_NAMES } from 'src/global/constants/defaultRoles.constant';
import { selfProjectProtected } from 'src/global/access/selfProjectProtection';
import { CreateProject } from '../dto/createProject.dto';
import { FilterProject } from '../dto/filterProject.dto';
import { EditProject } from '../dto/editProject.dto';
import * as crypto from 'node:crypto';

@Injectable()
export class ProjectService {
  constructor(private prisma: PrismaService) {}

  async findAll(filter: FilterProject): Promise<Project[]> {
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
      skip: page,
      take: limit,
    });

    if (!projects.length) {
      throw new NotFoundException('No Projects Found');
    }

    return projects;
  }

  async findById(id: string): Promise<Project> {
    const project = await this.prisma.project.findUnique({ where: { id } });

    if (!project) {
      throw new NotFoundException('Project not found');
    }

    return project;
  }

  /**
   * Todo projeto nasce com os papeis padrao, e eles nascem vazios: o que cada
   * um alcanca e marcado depois, rota por rota.
   */
  async createProject(data: CreateProject): Promise<Project> {
    const clientId = crypto.randomBytes(32).toString('hex');

    // Devolve o registro criado, e nao o DTO de entrada: sem isso o console
    // nunca fica sabendo o clientId gerado, que e justamente o que a
    // aplicacao cliente precisa para se conectar.
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
      throw new NotFoundException('Project Not Found');
    }

    // O SSO acha o próprio projeto pelo nome. Renomear tira a administracao do ar.
    if (project.name === SSO_SELF_PROJECT_NAME) {
      throw selfProjectProtected(
        'o projeto SSO nao pode ser renomeado: o proprio SSO se encontra por este nome',
      );
    }

    const editProject = await this.prisma.project.update({
      where: { id },
      data,
    });

    return editProject;
  }

  /**
   * Liga ou corta o acesso da aplicacao ao SSO.
   *
   * E o ponto onde a autorizacao nasce: o projeto pode existir, ter rotas,
   * papeis e usuarios, e ainda assim nao conseguir iniciar um fluxo enquanto
   * nao estiver ACTIVE. Suspender derruba tambem a renovacao por refresh
   * token, porque o token endpoint faz a mesma checagem.
   */
  async setStatus(id: string, status: ProjectStatus): Promise<Project> {
    const project = await this.prisma.project.findUnique({ where: { id } });

    if (!project) {
      throw new NotFoundException('Project not found');
    }

    // Fora de ACTIVE o SSO nao emite token nem para quem o administra.
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

      // Ativar sem chave deixaria a aplicacao passar no authorize e falhar
      // so na troca do token, com erro confuso.
      if (keys === 0) {
        throw new BadRequestException(
          'cadastre ao menos uma chave publica em /clientkey antes de ativar',
        );
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
      throw new NotFoundException('Project not found');
    }

    return {
      id: project.id,
      name: project.name,
      status: project.status,
      clientId: project.clientId,
      createdAt: project.createdAt,
      activatedAt: project.activatedAt,
      suspendedAt: project.suspendedAt,
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

  /**
   * Apaga o projeto e o que so existe por causa dele: papeis, redirect URIs e
   * chaves de cliente. Recusa enquanto houver membros ou rotas, que precisam
   * sair antes, por decisao de quem administra.
   *
   * Sem rotas nao ha permissao, entao os papeis que sobram estao vazios. Todo
   * projeto nasce com os quatro padrao: sem apaga-los junto, nenhum projeto se
   * apagaria, e a chave estrangeira viraria um 500.
   */
  async deleteProject(id: string): Promise<void> {
    const project = await this.prisma.project.findUnique({
      where: { id },
      include: { projectUsers: true, routes: true },
    });

    if (!project) {
      throw new NotFoundException('Project not found');
    }

    if (project.name === SSO_SELF_PROJECT_NAME) {
      throw selfProjectProtected(
        'o projeto SSO nao pode ser apagado: e ele que administra todas as aplicacoes',
      );
    }

    if (project.projectUsers.length > 0) {
      throw new BadRequestException('This project have ongoing permissions');
    }

    if (project.routes.length > 0) {
      throw new BadRequestException(
        'Some routes are associated with this project',
      );
    }

    await this.prisma.$transaction([
      this.prisma.role.deleteMany({ where: { projectId: { equals: id } } }),
      this.prisma.redirectUri.deleteMany({
        where: { projectId: { equals: id } },
      }),
      this.prisma.clientKey.deleteMany({
        where: { projectId: { equals: id } },
      }),
      this.prisma.project.delete({ where: { id } }),
    ]);
  }
}
