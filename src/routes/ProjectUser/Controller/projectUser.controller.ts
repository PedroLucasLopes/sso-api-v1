import {
  Body,
  Controller,
  Delete,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
} from '@nestjs/common';
import { ProjectUserService } from '../Service/projectUser.service';
import { CreateProjectUser } from '../dto/createProjectUser.dto';
import { EditProjectUser } from '../dto/editProjectUser.dto';
import { ProjectUser } from 'generated/prisma/client';
import { AdminIdentity } from 'src/global/access/adminIdentity.dto';
import { CurrentAdmin } from 'src/global/decorator/currentAdmin.decorator';

@Controller('projectuser')
export class ProjectUserController {
  constructor(private projectUserService: ProjectUserService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async createProjectUser(
    @Body() data: CreateProjectUser,
    @CurrentAdmin() admin: AdminIdentity,
  ): Promise<ProjectUser> {
    return await this.projectUserService.createProjectUser(data, admin);
  }

  @Put(':projectId/:userId')
  @HttpCode(HttpStatus.OK)
  async changeRole(
    @Param('projectId') projectId: string,
    @Param('userId') userId: string,
    @Body() data: EditProjectUser,
    @CurrentAdmin() admin: AdminIdentity,
  ): Promise<ProjectUser> {
    return await this.projectUserService.changeRole(
      projectId,
      userId,
      data,
      admin,
    );
  }

  @Delete(':projectId/:userId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async removeMember(
    @Param('projectId') projectId: string,
    @Param('userId') userId: string,
    @CurrentAdmin() admin: AdminIdentity,
  ): Promise<void> {
    return await this.projectUserService.removeMember(projectId, userId, admin);
  }
}
