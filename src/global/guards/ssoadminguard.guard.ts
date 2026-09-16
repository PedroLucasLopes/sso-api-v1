import {
  CanActivate,
  ExecutionContext,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Response } from 'express';
import { AdminAccessService } from '../access/adminAccess.service';
import { RequestWithAdmin } from '../access/adminIdentity.dto';
import {
  SSO_LEVEL_AUTHENTICATED,
  SSO_LEVEL_PUBLIC,
} from '../constants/ssoLevel.constant';

/**
 * Guard global das rotas administrativas.
 *
 *   @Public()         libera
 *   @Authenticated()  exige credencial valida, sem consultar permissao
 *   (nenhum)          exige credencial E `Permission` para a rota pedida
 *
 * Credencial e Bearer do projeto do SSO ou o cookie de sessao do console.
 * Escrita pelo cookie exige ainda o token anti-CSRF.
 *
 * O caso sem decorator e o normal, e e o mais fechado dos tres: rota nova
 * nasce protegida e so responde depois de existir como `Route` no catalogo,
 * com `Permission` ligando algum papel a ela. Para quem nao alcanca a rota, a
 * resposta e o 404 de um caminho inexistente. O papel raiz do projeto `SSO`
 * passa sem consultar o catalogo.
 *
 * Antes daqui saia a comparacao de `x-sso-secret` com uma variavel de
 * ambiente. Um segredo compartilhado torna administrador todo mundo que le o
 * repositorio, nao registra quem agiu e so pode ser revogado para todos de
 * uma vez. A autorizacao agora vem dos usuarios cadastrados e dos papeis
 * que eles tem no projeto do proprio SSO.
 */
@Injectable()
export class SSOAdminGuard implements CanActivate {
  constructor(
    private reflector: Reflector,
    private access: AdminAccessService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (this.hasLevel(context, SSO_LEVEL_PUBLIC)) return true;

    const http = context.switchToHttp();
    const request = http.getRequest<RequestWithAdmin>();
    const response = http.getResponse<Response>();

    // RFC 6750 secao 3: recurso protegido que recusa um Bearer avisa como
    // se autentica. Sem isso o cliente so ve um 401 mudo.
    response.setHeader('WWW-Authenticate', 'Bearer realm="sso"');

    const authenticatedOnly = this.hasLevel(context, SSO_LEVEL_AUTHENTICATED);

    try {
      const identity = await this.access.authenticate(request, response, {
        hideMembership: !authenticatedOnly,
      });

      if (!authenticatedOnly) {
        await this.access.authorize(request, identity);
      }

      // Depois da permissao: escrita forjada para uma rota que a pessoa nao
      // alcanca recebe o mesmo 404 das outras, sem revelar que a rota existe.
      await this.access.assertSessionWrite(request, identity);

      // Disponivel ao handler por @CurrentAdmin(): e o que permite auditar
      // quem fez o que, coisa que o segredo em header nunca deu.
      request.ssoAdmin = identity;

      return true;
    } catch (error) {
      // O 404 imita o de um caminho que nao existe, e caminho que nao existe
      // nao anuncia como se autentica.
      if (error instanceof NotFoundException) {
        response.removeHeader('WWW-Authenticate');
      }

      throw error;
    }
  }

  private hasLevel(context: ExecutionContext, level: string): boolean {
    return (
      this.reflector.getAllAndOverride<boolean>(level, [
        context.getHandler(),
        context.getClass(),
      ]) === true
    );
  }
}
