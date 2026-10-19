import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';
import { ApiException } from '../error/apiError';

@Injectable()
export class SameOriginGuard implements CanActivate {
  private readonly logger = new Logger(SameOriginGuard.name);
  private readonly origins: Set<string>;

  constructor(config: ConfigService) {
    this.origins = new Set([
      new URL(config.getOrThrow<string>('SSO_LOGIN_URL')).origin,
      new URL(config.getOrThrow<string>('SSO_ISSUER')).origin,
    ]);
  }

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();

    if (!request.is('application/json')) {
      throw new ApiException('json_required');
    }

    const origin = request.headers.origin;

    if (origin !== undefined && !this.origins.has(origin)) {
      this.logger.warn(`pedido de conta de origem nao autorizada: ${origin}`);

      throw new ForbiddenException({
        error: 'origin_not_allowed',
        message: 'a origem do pedido nao e a tela de login do SSO',
      });
    }

    return true;
  }
}
