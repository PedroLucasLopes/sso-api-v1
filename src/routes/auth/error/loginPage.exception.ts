import { LoginErrorCode } from '../auth.constant';

export class LoginPageRedirectException extends Error {
  constructor(readonly code: LoginErrorCode) {
    super(code);
    this.name = LoginPageRedirectException.name;
  }
}
