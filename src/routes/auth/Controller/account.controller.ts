import {
  Body,
  Controller,
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
import { ACCOUNT_LINK_LIMIT } from '../account.constant';
import { AccountService } from '../Service/account.service';
import { AccountDeletionService } from '../Service/accountDeletion.service';
import {
  AccountDeletionView,
  AccountLinkToken,
  AccountLinkView,
  AccountPassword,
  AccountSignup,
} from '../dto/account.dto';
import { LoginStepView } from '../dto/loginStep.dto';

@Controller('account')
@Public()
@UseGuards(SameOriginGuard)
export class AccountController {
  constructor(
    private accounts: AccountService,
    private deletions: AccountDeletionService,
  ) {}

  @Post('link')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store')
  @Throttle(ACCOUNT_LINK_LIMIT)
  async link(@Body() body: AccountLinkToken): Promise<AccountLinkView> {
    return this.accounts.describeLink(body);
  }

  @Post('signup')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store')
  @Throttle(ACCOUNT_LINK_LIMIT)
  async signup(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Body() body: AccountSignup,
  ): Promise<LoginStepView> {
    return this.accounts.completeSignup(req, res, body);
  }

  @Post('password')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store')
  @Throttle(ACCOUNT_LINK_LIMIT)
  async password(
    @Res({ passthrough: true }) res: Response,
    @Body() body: AccountPassword,
  ): Promise<LoginStepView> {
    return this.accounts.completePasswordReset(res, body);
  }

  @Post('delete')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store')
  @Throttle(ACCOUNT_LINK_LIMIT)
  async delete(
    @Res({ passthrough: true }) res: Response,
    @Body() body: AccountLinkToken,
  ): Promise<AccountDeletionView> {
    return this.deletions.complete(res, body);
  }
}
