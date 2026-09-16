import {
  createParamDecorator,
  ExecutionContext,
  InternalServerErrorException,
} from '@nestjs/common';
import { AdminIdentity, RequestWithAdmin } from '../access/adminIdentity.dto';

/**
 * Injeta no handler quem esta agindo. So existe depois que o `SSOAdminGuard`
 * resolveu o token, entao usar em rota `@Public()` e erro de programacao e
 * falha alto em vez de entregar `undefined`.
 */
export const CurrentAdmin = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AdminIdentity => {
    const request = context.switchToHttp().getRequest<RequestWithAdmin>();

    if (!request.ssoAdmin) {
      throw new InternalServerErrorException(
        '@CurrentAdmin() usado em rota que nao passa pelo SSOAdminGuard',
      );
    }

    return request.ssoAdmin;
  },
);
