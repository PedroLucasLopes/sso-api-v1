import {
  Controller,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Post,
  Query,
  Req,
  Res,
  UseFilters,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { Public } from 'src/global/decorator/public.decorator';
import { AuthService } from '../Service/auth.service';
import { SessionLogin } from '../dto/sessionLogin.dto';
import { SessionView } from '../dto/sessionView.dto';
import {
  AuthorizeRedirectExceptionFilter,
  OAuthExceptionFilter,
} from '../error/oauth.filter';

@Controller('session')
@Public()
@UseFilters(OAuthExceptionFilter, AuthorizeRedirectExceptionFilter)
export class SessionController {
  constructor(private authService: AuthService) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  async current(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<SessionView> {
    return this.authService.describeSession(req, res);
  }

  @Get('login')
  async login(
    @Query() query: SessionLogin,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    await this.authService.beginSessionLogin(query, req, res);
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    await this.authService.endSession(req, res);
  }
}
