import { Controller, Get, HttpCode, HttpStatus } from '@nestjs/common';
import { AdminAccessService } from 'src/global/access/adminAccess.service';
import { AdminIdentity } from 'src/global/access/adminIdentity.dto';
import { Authenticated } from 'src/global/decorator/public.decorator';
import { CurrentAdmin } from 'src/global/decorator/currentAdmin.decorator';
import { Me } from '../dto/me.dto';

/**
 * Quem sou eu e o que posso fazer aqui.
 *
 * O console administrativo chama esta rota logo depois do login para montar
 * o menu com o que aquele usuario de fato alcanca. Sem ela o front teria de
 * adivinhar pelo papel, e voltariamos a ter regra de permissao escrita em
 * dois lugares.
 *
 * `@Authenticated()` e nao RBAC: a resposta e sobre o proprio solicitante,
 * entao exigir permissao para le-la criaria uma dependencia circular no
 * primeiro acesso de um usuario novo. E a unica rota que responde 403 a quem
 * nao tem papel no SSO; as outras respondem 404.
 */
@Controller('me')
@Authenticated()
export class MeController {
  constructor(private access: AdminAccessService) {}

  @Get()
  @HttpCode(HttpStatus.OK)
  async me(@CurrentAdmin() identity: AdminIdentity): Promise<Me> {
    return {
      id: identity.userId,
      email: identity.email,
      name: identity.name,
      role: identity.role,
      root: identity.root,
      permissions: await this.access.permissionsFor(identity),
      // So para o console, que se autentica pela sessao. Quem usa Bearer nao
      // precisa de defesa de CSRF, e nao recebe token nenhum.
      csrfToken: identity.via === 'session' ? identity.csrfToken : undefined,
    };
  }
}
