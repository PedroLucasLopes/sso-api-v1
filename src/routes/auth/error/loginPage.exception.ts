import { LoginErrorCode } from '../auth.constant';

/**
 * Falha que precisa ser explicada a uma PESSOA, na tela de login do front.
 *
 * Erro do fluxo OAuth vai para a aplicacao cliente, pela `redirect_uri`. Estes
 * sao os que acontecem antes de haver cliente a quem devolver, ou que so a
 * pessoa resolve: conta Google nao cadastrada, consentimento negado, pedido
 * expirado. Um JSON cru na aba do navegador nao explica nada a ninguem.
 */
export class LoginPageRedirectException extends Error {
  constructor(readonly code: LoginErrorCode) {
    super(code);
    this.name = LoginPageRedirectException.name;
  }
}
