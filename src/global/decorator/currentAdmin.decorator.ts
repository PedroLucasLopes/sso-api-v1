import { createParamDecorator, ExecutionContext, Logger } from '@nestjs/common';
import { AdminIdentity, RequestWithAdmin } from '../access/adminIdentity.dto';
import { ApiException } from '../error/apiError';

const logger = new Logger('CurrentAdmin');

export const CurrentAdmin = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AdminIdentity => {
    const request = context.switchToHttp().getRequest<RequestWithAdmin>();

    if (!request.ssoAdmin) {
      logger.error(
        '@CurrentAdmin() usado em rota que nao passa pelo SSOAdminGuard',
      );
      throw new ApiException('internal_error');
    }

    return request.ssoAdmin;
  },
);
