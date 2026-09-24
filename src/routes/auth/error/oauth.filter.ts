import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpStatus,
  Injectable,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Response } from 'express';
import { ApiException } from 'src/global/error/apiError';
import { FieldError } from 'src/global/error/validationError';
import { AuthorizeRedirectException, OAuthException } from './oauth.exception';

@Catch(OAuthException)
export class OAuthExceptionFilter implements ExceptionFilter {
  catch(exception: OAuthException, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>();

    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Pragma', 'no-cache');

    if (exception.getStatus() === Number(HttpStatus.UNAUTHORIZED)) {
      res.setHeader('WWW-Authenticate', 'Bearer realm="sso"');
    }

    res.status(exception.getStatus()).json({
      error: exception.error,
      error_description: exception.errorDescription,
    });
  }
}

@Catch(ApiException)
export class OAuthValidationFilter implements ExceptionFilter {
  catch(exception: ApiException, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>();

    if (exception.code !== 'validation_failed') {
      res.status(exception.getStatus()).json(exception.getResponse());
      return;
    }

    const { fields = [] } = exception.getResponse() as {
      fields?: FieldError[];
    };
    const grantType = fields.filter((field) => field.field === 'grant_type');
    const unsupported =
      grantType.length > 0 &&
      grantType.every((field) => field.error === 'unsupported_grant_type');

    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Pragma', 'no-cache');

    res.status(HttpStatus.BAD_REQUEST).json(
      unsupported
        ? {
            error: 'unsupported_grant_type',
            error_description: 'grant_type nao suportado',
          }
        : {
            error: 'invalid_request',
            error_description: 'parametro ausente, invalido ou desconhecido',
          },
    );
  }
}

@Catch(AuthorizeRedirectException)
@Injectable()
export class AuthorizeRedirectExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(AuthorizeRedirectExceptionFilter.name);
  private readonly issuer: string;

  constructor(config: ConfigService) {
    this.issuer = config.getOrThrow<string>('SSO_ISSUER').replace(/\/+$/, '');
  }

  catch(exception: AuthorizeRedirectException, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>();
    const target = new URL(exception.redirectUri);

    target.searchParams.set('error', exception.error);
    target.searchParams.set('error_description', exception.errorDescription);

    if (exception.state) {
      target.searchParams.set('state', exception.state);
    }

    target.searchParams.set('iss', this.issuer);

    this.logger.warn(
      `authorize recusado: ${exception.error} (${exception.errorDescription})`,
    );

    res.redirect(target.toString());
  }
}
