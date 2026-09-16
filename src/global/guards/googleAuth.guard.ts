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

  /**
   * So ha federacao com pedido pendente.
   *
   * A tela de login e o trecho do Google existem para devolver a pessoa a uma
   * aplicacao que pediu. Sem pedido nao ha para onde voltar, e seguir ate o
   * Google so terminaria num erro depois do consentimento. Quem chega aqui sem
   * transacao volta a tela de login, que explica o motivo.
   */
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request>();

    if (!this.pendingTransaction(req)) {
      throw new LoginPageRedirectException(
        req.path.endsWith('/callback') ? 'request_expired' : 'no_pending_request',
      );
    }

    return (await super.canActivate(context)) as boolean;
  }

  /**
   * Injeta o nonce da transacao como `state` da requisicao ao Google.
   *
   * O `passport-google-oauth20` roda com o proprio armazenamento de state
   * desligado, porque ele depende de express-session e aqui nao ha sessao de
   * servidor. Quem guarda e confere o nonce e o cookie de transacao, no
   * AuthService. Sem isso o trecho SSO -> Google ficaria sem CSRF.
   */
  getAuthenticateOptions(context: ExecutionContext): IAuthModuleOptions {
    const req = context.switchToHttp().getRequest<Request>();

    return {
      session: false,
      state: this.pendingTransaction(req)?.googleNonce,
    };
  }

  /**
   * Traduz a recusa do provedor em algo que a pessoa entende.
   *
   * O padrao do Nest aqui e um 401 em JSON na aba do navegador, justamente no
   * momento em que a pessoa mais precisa de explicacao: a conta nao esta
   * cadastrada, ou ela cancelou o consentimento.
   */
  handleRequest<TUser = unknown>(err: unknown, user: TUser): TUser {
    if (err instanceof IdentityProviderException) {
      throw new LoginPageRedirectException(err.code);
    }

    if (err) throw new LoginPageRedirectException('provider_error');

    // O passport chama `fail()`, sem erro, quando o Google volta com
    // `error=access_denied`: a pessoa cancelou o consentimento.
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
