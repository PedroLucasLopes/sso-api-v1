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
import { ProjectListing, ProjectService } from '../Service/project.service';
import { FilterProject } from '../dto/filterProject.dto';
import { Project } from 'generated/prisma/client';
import { AdminIdentity } from 'src/global/access/adminIdentity.dto';
import { CurrentAdmin } from 'src/global/decorator/currentAdmin.decorator';
import { CreateProject } from '../dto/createProject.dto';
import { EditProject } from '../dto/editProject.dto';
import {
  ProjectOverview,
  SetProjectPolicy,
  SetProjectStatus,
} from '../dto/projectOverview.dto';

@Controller('project')
export class ProjectController {
  constructor(private projectService: ProjectService) {}

  @Get()
  @HttpCode(HttpStatus.OK)
  async findAll(@Query() filter: FilterProject): Promise<ProjectListing[]> {
    return await this.projectService.findAll(filter);
  }

  @Get(':id')
  @HttpCode(HttpStatus.OK)
  async findById(@Param('id') id: string): Promise<Project> {
    return await this.projectService.findById(id);
  }

  @Get(':id/overview')
  @HttpCode(HttpStatus.OK)
  async overview(@Param('id') id: string): Promise<ProjectOverview> {
    return await this.projectService.overview(id);
  }

  @Patch(':id/status')
  @HttpCode(HttpStatus.OK)
  async setStatus(
    @Param('id') id: string,
    @Body() data: SetProjectStatus,
  ): Promise<Project> {
    return await this.projectService.setStatus(id, data.status);
  }

  @Patch(':id/policy')
  @HttpCode(HttpStatus.OK)
  async setPolicy(
    @Param('id') id: string,
    @Body() data: SetProjectPolicy,
    @CurrentAdmin() admin: AdminIdentity,
  ): Promise<Project> {
    return await this.projectService.setPolicy(id, data, admin);
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
