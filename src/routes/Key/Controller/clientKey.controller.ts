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

  /** Cadastra uma chave publica que o dono da aplicacao gerou na propria maquina. */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(
    @Body() data: CreateClientKey,
    @CurrentAdmin() admin: AdminIdentity,
  ): Promise<ClientKey> {
    return this.clientKeyService.create(data, admin);
  }

  /**
   * Gera o par dentro do SSO e devolve a privada UMA UNICA VEZ.
   *
   * A resposta carrega segredo, e quem administra cadastro comum nao precisa
   * ver material de chave. Quem alcanca esta rota e decidido no catalogo, com
   * `Permission`, e nao por decorator: a regra mora no banco e muda sem deploy.
   * `no-store` impede que proxy ou navegador guardem a resposta.
   */
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
