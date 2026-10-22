import {
  CanActivate,
  ExecutionContext,
  Injectable,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { HumanCheckService } from './humanCheck.service';
import {
  HUMAN_CHECK_HEADER,
  HUMAN_CHECK_METADATA,
  HumanCheckAction,
} from './security.constant';

@Injectable()
export class HumanCheckGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly check: HumanCheckService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const action = this.reflector.getAllAndOverride<
      HumanCheckAction | undefined
    >(HUMAN_CHECK_METADATA, [context.getHandler(), context.getClass()]);

    if (!action || !this.check.widget) return true;

    const request = context.switchToHttp().getRequest<Request>();
    const token = request.headers[HUMAN_CHECK_HEADER];

    await this.check.verify(
      typeof token === 'string' ? token : undefined,
      action,
      request.ip,
    );

    return true;
  }
}

export const RequireHuman = (action: HumanCheckAction) =>
  SetMetadata(HUMAN_CHECK_METADATA, action);
