import { HttpException, HttpStatus } from '@nestjs/common';

/** Codigos normativos da RFC 6749 secoes 4.1.2.1 e 5.2. */
export type OAuthErrorCode =
  | 'invalid_request'
  | 'invalid_client'
  | 'invalid_grant'
  | 'unauthorized_client'
  | 'unsupported_grant_type'
  | 'unsupported_response_type'
  | 'invalid_scope'
  | 'access_denied'
  | 'server_error'
  | 'temporarily_unavailable';

/**
 * Erro do token endpoint (RFC 6749 secao 5.2).
 *
 * O corpo e exatamente `{ error, error_description }`, e nao o formato padrao
 * do Nest (`{ statusCode, message, error }`), senao nenhum cliente OAuth
 * generico consegue interpretar a resposta.
 *
 * Status: 400 para tudo, menos `invalid_client`, que e 401.
 */
export class OAuthException extends HttpException {
  constructor(
    readonly error: OAuthErrorCode,
    readonly errorDescription: string,
    status: HttpStatus = HttpStatus.BAD_REQUEST,
  ) {
    super({ error, error_description: errorDescription }, status);
  }

  static invalidClient(description: string): OAuthException {
    return new OAuthException(
      'invalid_client',
      description,
      HttpStatus.UNAUTHORIZED,
    );
  }
}

/**
 * Erro do authorization endpoint que DEVE voltar para o cliente pela
 * redirect_uri (RFC 6749 secao 4.1.2.1).
 *
 * So se usa esta variante depois que `client_id` e `redirect_uri` ja foram
 * validados. Enquanto nao estiverem, a mesma secao proibe redirecionar: o
 * erro tem de ser mostrado ao usuario, senao o servidor vira um open redirect.
 */
export class AuthorizeRedirectException extends Error {
  constructor(
    readonly redirectUri: string,
    readonly error: OAuthErrorCode,
    readonly errorDescription: string,
    readonly state?: string,
  ) {
    super(`${error}: ${errorDescription}`);
    this.name = AuthorizeRedirectException.name;
  }
}
