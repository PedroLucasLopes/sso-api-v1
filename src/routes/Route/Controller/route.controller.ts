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
  UseFilters,
} from '@nestjs/common';
import { RouteService } from '../Service/route.service';
import { FilterRoute } from '../dto/filterRoute.dto';
import { Route } from 'generated/prisma/client';
import { CreateRoute } from '../dto/createRoute.dto';
import { PrismaExceptionValidationFilter } from 'src/global/error/prismaclientvalidationerror.exception';
import { EditRoute } from '../dto/editRoute.dto';
import { AdminIdentity } from 'src/global/access/adminIdentity.dto';
import { CurrentAdmin } from 'src/global/decorator/currentAdmin.decorator';

@Controller('route')
export class RouteController {
  constructor(private routeService: RouteService) {}

  @Get()
  @HttpCode(HttpStatus.OK)
  async findAll(@Query() filter: FilterRoute): Promise<Route[]> {
    return await this.routeService.findAll(filter);
  }

  @Get(':id')
  @HttpCode(HttpStatus.OK)
  async findById(@Param('id') id: string): Promise<Route> {
    return await this.routeService.findById(id);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @UseFilters(new PrismaExceptionValidationFilter())
  async createRoute(
    @Body() data: CreateRoute,
    @CurrentAdmin() admin: AdminIdentity,
  ): Promise<Route> {
    return await this.routeService.createRoute(data, admin);
  }

  @Put(':id')
  @HttpCode(HttpStatus.OK)
  async updateRoute(
    @Param('id') id: string,
    @Body() data: EditRoute,
    @CurrentAdmin() admin: AdminIdentity,
  ): Promise<Route> {
    return await this.routeService.updateRoute(id, data, admin);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteRoute(
    @Param('id') id: string,
    @CurrentAdmin() admin: AdminIdentity,
  ): Promise<void> {
    return await this.routeService.deleteRoute(id, admin);
  }
}
