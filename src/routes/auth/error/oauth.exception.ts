import { HttpException, HttpStatus } from '@nestjs/common';

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
