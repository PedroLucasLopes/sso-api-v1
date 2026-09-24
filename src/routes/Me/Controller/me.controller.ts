import { Controller, Get, HttpCode, HttpStatus } from '@nestjs/common';
import { AdminAccessService } from 'src/global/access/adminAccess.service';
import { AdminIdentity } from 'src/global/access/adminIdentity.dto';
import { Authenticated } from 'src/global/decorator/public.decorator';
import { CurrentAdmin } from 'src/global/decorator/currentAdmin.decorator';
import { Me } from '../dto/me.dto';

@Controller('me')
@Authenticated()
export class MeController {
  constructor(private access: AdminAccessService) {}

  @Get()
  @HttpCode(HttpStatus.OK)
  async me(@CurrentAdmin() identity: AdminIdentity): Promise<Me> {
    return {
      id: identity.userId,
      email: identity.email,
      name: identity.name,
      role: identity.role,
      root: identity.root,
      permissions: await this.access.permissionsFor(identity),
      csrfToken: identity.via === 'session' ? identity.csrfToken : undefined,
    };
  }
}
