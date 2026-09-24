import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  Injectable,
  Logger,
} from '@nestjs/common';
import { Response } from 'express';
import { LoginPageService } from '../Service/loginPage.service';
import { LoginPageRedirectException } from './loginPage.exception';

@Catch(LoginPageRedirectException)
@Injectable()
export class LoginPageRedirectFilter implements ExceptionFilter {
  private readonly logger = new Logger(LoginPageRedirectFilter.name);

  constructor(private loginPage: LoginPageService) {}

  catch(exception: LoginPageRedirectException, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>();

    this.logger.warn(`login interrompido: ${exception.code}`);

    res.setHeader('Cache-Control', 'no-store');
    res.redirect(this.loginPage.url(exception.code));
  }
}
