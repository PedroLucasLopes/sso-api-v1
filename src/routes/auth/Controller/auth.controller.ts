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
import { Throttle } from '@nestjs/throttler';
import { Request, Response } from 'express';
import { Public } from 'src/global/decorator/public.decorator';
import { GoogleAuthGuard } from 'src/global/guards/googleAuth.guard';
import { AuthService } from '../Service/auth.service';
import { Authorize } from '../dto/authorize.dto';
import { GoogleUser } from '../dto/googleUser';
import { Introspect, IntrospectionResponse } from '../dto/introspect.dto';
import { PermissionSet, ResolvePermissions } from '../dto/permissionSet.dto';
import { Revoke } from '../dto/revoke.dto';
import { Token } from '../dto/token.dto';
import { TokenResponse } from '../dto/tokenResponse.dto';
import { LoginPageRedirectFilter } from '../error/loginPage.filter';
import {
  AuthorizeRedirectExceptionFilter,
  OAuthExceptionFilter,
  OAuthValidationFilter,
} from '../error/oauth.filter';

@Controller('oauth')
@Public()
@UseFilters(
  OAuthExceptionFilter,
  AuthorizeRedirectExceptionFilter,
  LoginPageRedirectFilter,
  OAuthValidationFilter,
)
export class AuthController {
  constructor(private authService: AuthService) {}

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
  googleLogin(): void {}

  @Get('google/callback')
  @UseGuards(GoogleAuthGuard)
  async googleCallback(
    @Req() req: Request & { user: GoogleUser },
    @Res() res: Response,
  ): Promise<void> {
    await this.authService.completeGoogleLogin(req, res, req.user);
  }

  @Post('token')
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store')
  @Header('Pragma', 'no-cache')
  async token(@Body() body: Token): Promise<TokenResponse> {
    return this.authService.exchangeToken(body);
  }

  @Post('permissions')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store')
  async permissions(@Body() body: ResolvePermissions): Promise<PermissionSet> {
    return this.authService.resolvePermissions(body);
  }

  @Post('revoke')
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store')
  async revoke(@Body() body: Revoke): Promise<void> {
    await this.authService.revokeToken(body);
  }

  @Post('introspect')
  @Throttle({ default: { limit: 1200, ttl: 60_000 } })
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store')
  async introspect(@Body() body: Introspect): Promise<IntrospectionResponse> {
    return this.authService.introspect(body);
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    await this.authService.logout(req, res);
  }
}
