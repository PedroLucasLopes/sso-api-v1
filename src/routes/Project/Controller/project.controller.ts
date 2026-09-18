import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ProjectService } from '../Service/project.service';
import { FilterProject } from '../dto/filterProject.dto';
import { Project } from 'generated/prisma/client';
import { CreateProject } from '../dto/createProject.dto';
import { EditProject } from '../dto/editProject.dto';
import { ProjectOverview, SetProjectStatus } from '../dto/projectOverview.dto';

@Controller('project')
export class ProjectController {
  constructor(private projectService: ProjectService) {}

  @Get()
  @HttpCode(HttpStatus.OK)
  async findAll(@Query() filter: FilterProject): Promise<Project[]> {
    return await this.projectService.findAll(filter);
  }

  @Get(':id')
  @HttpCode(HttpStatus.OK)
  async findById(@Param('id') id: string): Promise<Project> {
    return await this.projectService.findById(id);
  }

  /**
   * Retrato completo: identidade, credencial, rotas, papeis e quem tem acesso
   * com qual permissao. Responde numa chamada o que antes exigia cruzar cinco.
   */
  @Get(':id/overview')
  @HttpCode(HttpStatus.OK)
  async overview(@Param('id') id: string): Promise<ProjectOverview> {
    return await this.projectService.overview(id);
  }

  /**
   * Liga ou corta o acesso da aplicacao ao SSO. Um projeto nasce PENDING:
   * a autorizacao para usar o SSO nasce aqui dentro, nao na aplicacao.
   */
  @Patch(':id/status')
  @HttpCode(HttpStatus.OK)
  async setStatus(
    @Param('id') id: string,
    @Body() data: SetProjectStatus,
  ): Promise<Project> {
    return await this.projectService.setStatus(id, data.status);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async createProject(@Body() data: CreateProject): Promise<Project> {
    return await this.projectService.createProject(data);
  }

  @Put(':id')
  @HttpCode(HttpStatus.OK)
  async updateProject(
    @Param('id') id: string,
    @Body() data: EditProject,
  ): Promise<Project> {
    return await this.projectService.updateProject(id, data);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteProject(@Param('id') id: string) {
    return await this.projectService.deleteProject(id);
  }
}
