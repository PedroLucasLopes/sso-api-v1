import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Request, Response } from 'express';
import { Public } from 'src/global/decorator/public.decorator';
import { AuthService } from '../Service/auth.service';
import { LoginFlowService } from '../Service/loginFlow.service';
import { LoginRequestView } from '../dto/loginRequest.dto';
import {
  LoginStepView,
  MfaCode,
  NewPassword,
  PasswordLogin,
} from '../dto/loginStep.dto';

const CREDENTIAL_LIMIT = { default: { limit: 10, ttl: 60_000 } };

@Controller('login')
@Public()
export class LoginController {
  constructor(
    private authService: AuthService,
    private loginFlow: LoginFlowService,
  ) {}

  @Get('request')
  @Header('Cache-Control', 'no-store')
  request(@Req() req: Request): LoginRequestView {
    return this.authService.pendingRequest(req);
  }

  @Post('password')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store')
  @Throttle(CREDENTIAL_LIMIT)
  async password(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Body() body: PasswordLogin,
  ): Promise<LoginStepView> {
    return this.loginFlow.withPassword(req, res, body);
  }

  @Post('password/change')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store')
  @Throttle(CREDENTIAL_LIMIT)
  async changePassword(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Body() body: NewPassword,
  ): Promise<LoginStepView> {
    return this.loginFlow.changePassword(req, res, body);
  }

  @Post('mfa/setup')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store')
  @Throttle(CREDENTIAL_LIMIT)
  setupMfa(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): LoginStepView {
    return this.loginFlow.startMfaEnrollment(req, res);
  }

  @Post('mfa/confirm')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store')
  @Throttle(CREDENTIAL_LIMIT)
  async confirmMfa(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Body() body: MfaCode,
  ): Promise<LoginStepView> {
    return this.loginFlow.confirmMfaEnrollment(req, res, body);
  }

  @Post('mfa')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store')
  @Throttle(CREDENTIAL_LIMIT)
  async mfa(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Body() body: MfaCode,
  ): Promise<LoginStepView> {
    return this.loginFlow.verifyMfa(req, res, body);
  }
}
