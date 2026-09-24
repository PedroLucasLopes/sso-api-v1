import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LoginErrorCode } from '../auth.constant';

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
