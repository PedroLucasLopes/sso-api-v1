import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { Role } from 'generated/prisma/client';
import { RoleService } from '../Service/role.service';
import { CreateRole } from '../dto/createRole.dto';
import { EditRole } from '../dto/editRole.dto';
import { FilterRole } from '../dto/filterRole.dto';
import { AdminIdentity } from 'src/global/access/adminIdentity.dto';
import { CurrentAdmin } from 'src/global/decorator/currentAdmin.decorator';

@Controller('role')
export class RoleController {
  constructor(private roleService: RoleService) {}

  @Get()
  @HttpCode(HttpStatus.OK)
  async findAll(@Query() filter: FilterRole): Promise<Role[]> {
    return await this.roleService.findAll(filter);
  }

  @Get(':id')
  @HttpCode(HttpStatus.OK)
  async findById(@Param('id') id: string): Promise<Role> {
    return await this.roleService.findById(id);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async createRole(
    @Body() data: CreateRole,
    @CurrentAdmin() admin: AdminIdentity,
  ): Promise<Role> {
    return await this.roleService.createRole(data, admin);
  }

  @Put(':id')
  @HttpCode(HttpStatus.OK)
  async updateRole(
    @Param('id') id: string,
    @Body() data: EditRole,
    @CurrentAdmin() admin: AdminIdentity,
  ): Promise<Role> {
    return await this.roleService.updateRole(id, data, admin);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteRole(
    @Param('id') id: string,
    @CurrentAdmin() admin: AdminIdentity,
  ): Promise<void> {
    return await this.roleService.deleteRole(id, admin);
  }
}
