import { Method } from 'generated/prisma/enums';

export interface MePermission {
  path: string;
  method: Method;
}

/** O que o console precisa saber para desenhar o menu de quem entrou. */
export interface Me {
  id: string;
  email: string;
  name: string;
  role: string;
  /**
   * `true` para o papel raiz do projeto `SSO`. Ela alcanca toda rota
   * administrativa sem depender do catalogo, e `permissions` traz todas as que o
   * servidor expoe, cadastradas ou nao.
   */
  root: boolean;
  permissions: MePermission[];
  /**
   * Copia legivel do token anti-CSRF da sessao. O console a devolve no header
   * `X-CSRF-Token` em toda escrita. Ausente quando a credencial e Bearer.
   */
  csrfToken?: string;
}
