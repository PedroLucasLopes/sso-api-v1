import {
  Body,
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
  UseGuards,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { Public } from 'src/global/decorator/public.decorator';
import { GoogleAuthGuard } from 'src/global/guards/googleAuth.guard';
import { AuthService } from '../Service/auth.service';
import { Authorize } from '../dto/authorize.dto';
import { GoogleUser } from '../dto/googleUser';
import { PermissionSet, ResolvePermissions } from '../dto/permissionSet.dto';
import { Revoke } from '../dto/revoke.dto';
import { Token } from '../dto/token.dto';
import { TokenResponse } from '../dto/tokenResponse.dto';
import { LoginPageRedirectFilter } from '../error/loginPage.filter';
import {
  AuthorizeRedirectExceptionFilter,
  OAuthExceptionFilter,
} from '../error/oauth.filter';

@Controller('oauth')
@Public()
@UseFilters(
  OAuthExceptionFilter,
  AuthorizeRedirectExceptionFilter,
  LoginPageRedirectFilter,
)
export class AuthController {
  constructor(private authService: AuthService) {}

  /**
   * Inicio do fluxo. Com sessao viva no SSO emite o code direto; sem ela,
   * guarda o pedido no cookie e manda a pessoa a tela de login do front.
   */
  @Get('authorize')
  async authorize(
    @Query() query: Authorize,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    await this.authService.beginAuthorization(query, req, res);
  }

  @Get('google')
  @UseGuards(GoogleAuthGuard)
  googleLogin(): void {
    // O guard redireciona para o Google; este handler nunca executa.
  }

  @Get('google/callback')
  @UseGuards(GoogleAuthGuard)
  async googleCallback(
    @Req() req: Request & { user: GoogleUser },
    @Res() res: Response,
  ): Promise<void> {
    await this.authService.completeGoogleLogin(req, res, req.user);
  }

  /**
   * RFC 6749 secao 5.1: a resposta do token endpoint MUST vir com
   * `Cache-Control: no-store`. O filtro de erro repete o header, para que
   * a resposta de falha tambem nao seja cacheada.
   */
  @Post('token')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store')
  @Header('Pragma', 'no-cache')
  async token(@Body() body: Token): Promise<TokenResponse> {
    return this.authService.exchangeToken(body);
  }

  /**
   * Resolve um papel no conjunto de rotas que ele libera.
   *
   * O access token carrega `roles`, nao a lista de rotas. A aplicacao vem
   * aqui uma vez por papel e cacheia pelo `hash` devolvido.
   */
  @Post('permissions')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store')
  async permissions(@Body() body: ResolvePermissions): Promise<PermissionSet> {
    return this.authService.resolvePermissions(body);
  }

  /**
   * Revocation endpoint (RFC 7009). Responde 200 mesmo para token
   * desconhecido, de proposito: a secao 2.2 nao quer o endpoint virando
   * oraculo sobre quais tokens existem.
   */
  @Post('revoke')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store')
  async revoke(@Body() body: Revoke): Promise<void> {
    await this.authService.revokeToken(body);
  }

  /** Encerra a sessao no SSO e revoga os refresh tokens de todos os projetos. */
  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    await this.authService.logout(req, res);
  }
}
