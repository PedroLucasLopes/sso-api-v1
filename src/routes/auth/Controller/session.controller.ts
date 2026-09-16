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

/**
 * Login e logout do console do proprio SSO.
 *
 * O console se autentica pela sessao do SSO, na mesma origem da API (RFC 10017
 * secao 7.1). Para entrar, faz o que qualquer aplicacao faz: manda a pessoa ao
 * SSO com uma `redirect_uri` registrada e recebe de volta um `state` dele. A
 * tela de login nunca abre sem esse pedido.
 */
@Controller('session')
@Public()
@UseFilters(OAuthExceptionFilter, AuthorizeRedirectExceptionFilter)
export class SessionController {
  constructor(private authService: AuthService) {}

  /**
   * Estado da sessao deste navegador, com o token anti-CSRF.
   *
   * Publico e sem RBAC de proposito: quem entrou mas nao tem papel no console
   * ainda precisa do token para sair. O token so vale junto com o cookie, e a
   * politica de mesma origem impede outro site de ler esta resposta.
   */
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

  /** Encerra a sessao no SSO e derruba os refresh tokens de todos os projetos. */
  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    await this.authService.endSession(req, res);
  }
}
