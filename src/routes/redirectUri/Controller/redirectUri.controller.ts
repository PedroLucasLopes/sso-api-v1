import {
  Body,
  Controller,
  Delete,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
} from '@nestjs/common';
import { RedirectUriService } from '../Service/redirectUri.service';
import { redirectUri } from 'generated/prisma/client';
import { CreateRedirectUri } from '../dto/createRedirectUri.dto';
import { EditRedirectUri } from '../dto/editRedirectUri.dto';
import { AdminIdentity } from 'src/global/access/adminIdentity.dto';
import { CurrentAdmin } from 'src/global/decorator/currentAdmin.decorator';

@Controller('redirecturi')
export class RedirectUriController {
  constructor(private redirectUriService: RedirectUriService) {}

  /**
   * O corpo e tipado pelo DTO, e nao pelo model do Prisma. Com o model, o
   * ValidationPipe nao tinha classe para validar e deixava passar qualquer
   * coisa, inclusive campo a mais.
   */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  async createRedirectUri(
    @Body() data: CreateRedirectUri,
    @CurrentAdmin() admin: AdminIdentity,
  ): Promise<redirectUri> {
    return await this.redirectUriService.createRedirectUri(data, admin);
  }

  @Put(':id')
  @HttpCode(HttpStatus.OK)
  async updateRedirectUri(
    @Param('id') id: string,
    @Body() data: EditRedirectUri,
    @CurrentAdmin() admin: AdminIdentity,
  ): Promise<redirectUri> {
    return await this.redirectUriService.updateRedirectUri(id, data, admin);
  }

  /**
   * O `Origin` so pesa no projeto do proprio SSO: e por ele que o servidor sabe
   * que o console esta tentando apagar o endereco pelo qual ele mesmo entra.
   */
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteRedirectUri(
    @Param('id') id: string,
    @CurrentAdmin() admin: AdminIdentity,
    @Headers('origin') origin?: string,
  ): Promise<void> {
    return await this.redirectUriService.deleteRedirectUri(id, admin, origin);
  }
}
