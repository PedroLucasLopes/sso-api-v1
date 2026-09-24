import { LoginErrorCode } from '../auth.constant';

export class IdentityProviderException extends Error {
  constructor(
    readonly code: Extract<
      LoginErrorCode,
      | 'account_not_registered'
      | 'email_not_verified'
      | 'account_mismatch'
      | 'provider_error'
    >,
    message: string,
  ) {
    super(message);
    this.name = IdentityProviderException.name;
  }
}
