import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { ClientKey } from 'generated/prisma/client';
import { AdminIdentity } from 'src/global/access/adminIdentity.dto';
import { CurrentAdmin } from 'src/global/decorator/currentAdmin.decorator';
import { ClientKeyService } from '../Service/clientKey.service';
import { CreateClientKey } from '../dto/createClientKey.dto';
import {
  GenerateClientKey,
  GeneratedClientKey,
} from '../dto/generatedClientKey.dto';

@Controller('clientkey')
export class ClientKeyController {
  constructor(private clientKeyService: ClientKeyService) {}

  @Get()
  @HttpCode(HttpStatus.OK)
  async findByProject(
    @Query('projectId') projectId: string,
  ): Promise<ClientKey[]> {
    return this.clientKeyService.findByProject(projectId);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(
    @Body() data: CreateClientKey,
    @CurrentAdmin() admin: AdminIdentity,
  ): Promise<ClientKey> {
    return this.clientKeyService.create(data, admin);
  }

  @Post('generate')
  @HttpCode(HttpStatus.CREATED)
  @Header('Cache-Control', 'no-store')
  @Header('Pragma', 'no-cache')
  async generate(
    @Body() data: GenerateClientKey,
    @CurrentAdmin() admin: AdminIdentity,
  ): Promise<GeneratedClientKey> {
    return this.clientKeyService.generateKeyPair(data.projectId, admin);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async revoke(
    @Param('id') id: string,
    @CurrentAdmin() admin: AdminIdentity,
  ): Promise<void> {
    return this.clientKeyService.revoke(id, admin);
  }
}
