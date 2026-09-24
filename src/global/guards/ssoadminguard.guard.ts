import {
  CanActivate,
  ExecutionContext,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Response } from 'express';
import { AdminAccessService } from '../access/adminAccess.service';
import { RequestWithAdmin } from '../access/adminIdentity.dto';
import {
  SSO_LEVEL_AUTHENTICATED,
  SSO_LEVEL_PUBLIC,
} from '../constants/ssoLevel.constant';

@Injectable()
export class SSOAdminGuard implements CanActivate {
  constructor(
    private reflector: Reflector,
    private access: AdminAccessService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (this.hasLevel(context, SSO_LEVEL_PUBLIC)) return true;

    const http = context.switchToHttp();
    const request = http.getRequest<RequestWithAdmin>();
    const response = http.getResponse<Response>();

    response.setHeader('WWW-Authenticate', 'Bearer realm="sso"');

    const authenticatedOnly = this.hasLevel(context, SSO_LEVEL_AUTHENTICATED);

    try {
      const identity = await this.access.authenticate(request, response, {
        hideMembership: !authenticatedOnly,
      });

      if (!authenticatedOnly) {
        await this.access.authorize(request, identity);
      }

      await this.access.assertSessionWrite(request, identity);

      request.ssoAdmin = identity;

      return true;
    } catch (error) {
      if (error instanceof NotFoundException) {
        response.removeHeader('WWW-Authenticate');
      }

      throw error;
    }
  }

  private hasLevel(context: ExecutionContext, level: string): boolean {
    return (
      this.reflector.getAllAndOverride<boolean>(level, [
        context.getHandler(),
        context.getClass(),
      ]) === true
    );
  }
}
