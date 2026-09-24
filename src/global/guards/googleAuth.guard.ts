import { ExecutionContext, Injectable } from '@nestjs/common';
import { AuthGuard, IAuthModuleOptions } from '@nestjs/passport';
import { Request } from 'express';
import { CookieService } from '../cookie/cookie.service';
import {
  SSO_TX_COOKIE,
  TX_COOKIE_TTL_SECONDS,
} from 'src/routes/auth/auth.constant';
import { LoginTransaction } from 'src/routes/auth/dto/pkceTransaction.dto';
import { IdentityProviderException } from 'src/routes/auth/error/identityProvider.exception';
import { LoginPageRedirectException } from 'src/routes/auth/error/loginPage.exception';

@Injectable()
export class GoogleAuthGuard extends AuthGuard('google') {
  constructor(private cookies: CookieService) {
    super();
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request>();

    if (!this.pendingTransaction(req)) {
      throw new LoginPageRedirectException(
        req.path.endsWith('/callback')
          ? 'request_expired'
          : 'no_pending_request',
      );
    }

    return (await super.canActivate(context)) as boolean;
  }

  getAuthenticateOptions(context: ExecutionContext): IAuthModuleOptions {
    const req = context.switchToHttp().getRequest<Request>();

    return {
      session: false,
      state: this.pendingTransaction(req)?.googleNonce,
    };
  }

  handleRequest<TUser = unknown>(err: unknown, user: TUser): TUser {
    if (err instanceof IdentityProviderException) {
      throw new LoginPageRedirectException(err.code);
    }

    if (err) throw new LoginPageRedirectException('provider_error');

    if (!user) throw new LoginPageRedirectException('provider_denied');

    return user;
  }

  private pendingTransaction(req: Request): LoginTransaction | null {
    const transaction = this.cookies.get<LoginTransaction>(req, SSO_TX_COOKIE);

    if (!transaction?.googleNonce) return null;

    const age = Math.floor(Date.now() / 1000) - transaction.createdAt;

    return age > TX_COOKIE_TTL_SECONDS ? null : transaction;
  }
}
