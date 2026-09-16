import { Controller, Get, Header, Req } from '@nestjs/common';
import { Request } from 'express';
import { Public } from 'src/global/decorator/public.decorator';
import { AuthService } from '../Service/auth.service';
import { LoginRequestView } from '../dto/loginRequest.dto';

/**
 * O que a tela de login do front consulta para se desenhar.
 *
 * So responde quando ha pedido pendente, criado por `/oauth/authorize` ou por
 * `/session/login`. Sem ele devolve 404 e a tela nao oferece login: o IdP e um
 * passo de um fluxo que uma aplicacao inicia, nao uma pagina que se visita.
 */
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
