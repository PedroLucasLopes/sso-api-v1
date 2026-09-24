import { Controller, Get, Header, Req } from '@nestjs/common';
import { Request } from 'express';
import { Public } from 'src/global/decorator/public.decorator';
import { AuthService } from '../Service/auth.service';
import { LoginRequestView } from '../dto/loginRequest.dto';

@Controller('login')
@Public()
export class LoginController {
  constructor(private authService: AuthService) {}

  @Get('request')
  @Header('Cache-Control', 'no-store')
  request(@Req() req: Request): LoginRequestView {
    return this.authService.pendingRequest(req);
  }
}
