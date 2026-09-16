import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LoginErrorCode } from '../auth.constant';

/**
 * Endereco da tela de login do front, que e a interface do IdP.
 *
 * Vem do ambiente porque e fato de deploy, como `SSO_ISSUER`: so quem sobe o
 * front sabe onde ele esta. Nao e dado de catalogo, entao nao mora no banco.
 */
@Injectable()
export class LoginPageService {
  private readonly base: URL;

  constructor(config: ConfigService) {
    this.base = new URL(config.getOrThrow<string>('SSO_LOGIN_URL'));
  }

  url(error?: LoginErrorCode): string {
    const target = new URL(this.base);

    if (error) target.searchParams.set('error', error);

    return target.toString();
  }
}
