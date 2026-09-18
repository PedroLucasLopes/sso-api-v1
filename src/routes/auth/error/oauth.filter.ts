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
 * O ValidationPipe global recusa o corpo antes do service, no contrato de erro
 * da API (`validation_failed`, com os campos). No OAuth a resposta tem de ser a
 * da RFC 6749 secao 5.2: `invalid_request`, ou `unsupported_grant_type` quando o
 * que falhou foi so o valor do `grant_type`. A descricao e fixa: nome de campo
 * vindo do corpo poderia sair do conjunto de caracteres que a secao 5.2 permite.
 *
 * Qualquer outro `ApiException`, como o `role_not_found` do mapa de permissoes,
 * sai como veio.
 */
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

/**
 * Devolve o erro do authorization endpoint pela redirect_uri ja validada,
 * preservando o `state` para que o cliente consiga casar a resposta com a
 * requisicao que ele iniciou (RFC 6749 secao 4.1.2.1).
 *
 * Leva tambem o `iss`, como a resposta de sucesso. A RFC 9207 secao 2 o exige
 * em toda resposta de autorizacao, inclusive a de erro, e a secao 2.4 proibe o
 * cliente de supor que um erro veio do servidor certo sem conferi-lo.
 */
@Catch(AuthorizeRedirectException)
@Injectable()
export class AuthorizeRedirectExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(AuthorizeRedirectExceptionFilter.name);
  private readonly issuer: string;

  constructor(config: ConfigService) {
    // Sem barra no fim: o mesmo valor do `iss` do sucesso e do `issuer` do
    // discovery, que a RFC 9207 secao 2.3 quer identicos.
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
