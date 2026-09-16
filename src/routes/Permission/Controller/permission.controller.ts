import {
  Body,
  Controller,
  Delete,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  UseFilters,
} from '@nestjs/common';
import { PermissionService } from '../Service/permission.service';
import { CreatePermission } from '../dto/createPermission.dto';
import { Permission } from 'generated/prisma/client';
import { PrismaExceptionValidationFilter } from 'src/global/error/prismaclientvalidationerror.exception';
import { AdminIdentity } from 'src/global/access/adminIdentity.dto';
import { CurrentAdmin } from 'src/global/decorator/currentAdmin.decorator';

@Controller('permission')
export class PermissionController {
  constructor(private permissionService: PermissionService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @UseFilters(new PrismaExceptionValidationFilter())
  async createPermission(
    @Body() data: CreatePermission,
    @CurrentAdmin() admin: AdminIdentity,
  ): Promise<Permission> {
    return await this.permissionService.createPermission(data, admin);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deletePermission(
    @Param('id') id: string,
    @CurrentAdmin() admin: AdminIdentity,
  ): Promise<void> {
    return await this.permissionService.deletePermission(id, admin);
  }
}
