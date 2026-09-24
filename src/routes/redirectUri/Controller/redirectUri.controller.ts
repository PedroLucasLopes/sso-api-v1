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
