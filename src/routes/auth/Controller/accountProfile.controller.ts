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
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Request, Response } from 'express';
import { Public } from 'src/global/decorator/public.decorator';
import { SameOriginGuard } from 'src/global/security/sameOrigin.guard';
import { ACCOUNT_LINK_LIMIT, ACCOUNT_REQUEST_LIMIT } from '../account.constant';
import { AccountDeletionService } from '../Service/accountDeletion.service';
import { AccountProfileService } from '../Service/accountProfile.service';
import {
  AccountDeletionRequest,
  AccountDeletionView,
  AccountMfaConfirmView,
  AccountMfaSetup,
  AccountMfaSetupView,
  AccountProfileView,
} from '../dto/account.dto';
import { MfaCode } from '../dto/loginStep.dto';

@Controller('account')
@Public()
export class AccountProfileController {
  constructor(
    private readonly profiles: AccountProfileService,
    private readonly deletions: AccountDeletionService,
  ) {}

  @Get('profile')
  @Header('Cache-Control', 'no-store')
  async profile(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AccountProfileView> {
    return this.profiles.describe(req, res);
  }

  @Post('mfa/setup')
  @UseGuards(SameOriginGuard)
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store')
  @Throttle(ACCOUNT_LINK_LIMIT)
  async setupMfa(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Body() body: AccountMfaSetup,
  ): Promise<AccountMfaSetupView> {
    return this.profiles.startMfaEnrollment(req, res, body);
  }

  @Post('mfa/confirm')
  @UseGuards(SameOriginGuard)
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store')
  @Throttle(ACCOUNT_LINK_LIMIT)
  async confirmMfa(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Body() body: MfaCode,
  ): Promise<AccountMfaConfirmView> {
    return this.profiles.confirmMfaEnrollment(req, res, body);
  }

  @Post('deletion')
  @UseGuards(SameOriginGuard)
  @HttpCode(HttpStatus.ACCEPTED)
  @Header('Cache-Control', 'no-store')
  @Throttle(ACCOUNT_REQUEST_LIMIT)
  async requestDeletion(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Body() body: AccountDeletionRequest,
  ): Promise<AccountDeletionView> {
    return this.deletions.request(req, res, body);
  }
}
