import { LoginErrorCode } from '../auth.constant';

/**
 * Recusa do provedor federado, com um motivo que a tela de login sabe explicar.
 *
 * A mensagem fica no log; para a pessoa vai so o codigo, traduzido pelo front.
 */
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
