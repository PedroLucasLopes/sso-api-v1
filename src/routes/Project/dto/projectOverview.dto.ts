import { IsEnum, IsNotEmpty } from 'class-validator';
import { ProjectStatus } from 'generated/prisma/enums';

export class SetProjectStatus {
  @IsEnum(ProjectStatus)
  @IsNotEmpty()
  status: ProjectStatus;
}

/**
 * Retrato completo de um projeto num unico lugar: quem ele e, com que
 * credencial fala com o SSO, o que ele expoe e quem pode usar o que.
 *
 * Existia tudo isso no banco, mas espalhado por cinco endpoints diferentes.
 * Para responder "quem tem acesso a este sistema e com qual permissao" era
 * preciso cruzar as respostas na mao.
 */
export class ProjectOverview {
  id: string;
  name: string;
  status: ProjectStatus;
  /** Credencial publica da aplicacao. Nao e segredo: a prova e a chave privada. */
  clientId: string;
  createdAt: Date;
  activatedAt: Date | null;
  suspendedAt: Date | null;

  redirectUris: string[];

  /** As mesmas URIs com o id, que editar exige. */
  redirectUriRecords: Array<{ id: string; redirectUri: string }>;

  /** Metadados das chaves. O material publico fica em GET /clientkey. */
  clientKeys: Array<{
    id: string;
    createdAt: Date;
    expiresAt: Date | null;
    revokedAt: Date | null;
  }>;

  routes: Array<{ id: string; method: string; path: string }>;

  /**
   * Cada papel com as rotas que ele libera. O `id` da permissao e o que
   * `DELETE /permission/:id` pede, e o `routeId` casa com `routes`.
   */
  roles: Array<{
    id: string;
    name: string;
    permissions: Array<{
      id: string;
      routeId: string;
      method: string;
      path: string;
    }>;
  }>;

  /** Quem tem acesso, com que papel, e quantas rotas isso concede. */
  users: Array<{
    id: string;
    name: string;
    email: string;
    role: string;
    grantedRoutes: number;
  }>;
}
