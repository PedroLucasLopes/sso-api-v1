import { createParamDecorator, ExecutionContext, Logger } from '@nestjs/common';
import { AdminIdentity, RequestWithAdmin } from '../access/adminIdentity.dto';
import { ApiException } from '../error/apiError';

const logger = new Logger('CurrentAdmin');

/**
 * Injeta no handler quem esta agindo. So existe depois que o `SSOAdminGuard`
 * resolveu o token, entao usar em rota `@Public()` e erro de programacao e
 * falha alto em vez de entregar `undefined`.
 */
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
