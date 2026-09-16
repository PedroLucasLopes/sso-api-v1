import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Response } from 'express';
import { AuthorizeRedirectException, OAuthException } from './oauth.exception';

/**
 * Renderiza o erro do token endpoint no formato da RFC 6749 secao 5.2 e
 * garante `Cache-Control: no-store`, exigido pela secao 5.1 tanto na resposta
 * de sucesso quanto na de erro.
 */
@Catch(OAuthException)
export class OAuthExceptionFilter implements ExceptionFilter {
  catch(exception: OAuthException, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>();

    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Pragma', 'no-cache');

    // A RFC 6749 secao 5.2 pede o desafio de autenticacao quando o cliente
    // se identificou mal e a resposta e 401.
    // getStatus() devolve `number`, entao o enum e comparado como numero.
    if (exception.getStatus() === Number(HttpStatus.UNAUTHORIZED)) {
      res.setHeader('WWW-Authenticate', 'Bearer realm="sso"');
    }

    res.status(exception.getStatus()).json({
      error: exception.error,
      error_description: exception.errorDescription,
    });
  }
}

/**
 * Devolve o erro do authorization endpoint pela redirect_uri ja validada,
 * preservando o `state` para que o cliente consiga casar a resposta com a
 * requisicao que ele iniciou (RFC 6749 secao 4.1.2.1).
 */
@Catch(AuthorizeRedirectException)
export class AuthorizeRedirectExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(AuthorizeRedirectExceptionFilter.name);

  catch(exception: AuthorizeRedirectException, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>();
    const target = new URL(exception.redirectUri);

    target.searchParams.set('error', exception.error);
    target.searchParams.set('error_description', exception.errorDescription);

    if (exception.state) {
      target.searchParams.set('state', exception.state);
    }

    this.logger.warn(
      `authorize recusado: ${exception.error} (${exception.errorDescription})`,
    );

    res.redirect(target.toString());
  }
}
