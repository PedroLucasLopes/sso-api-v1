import { Request } from 'express';

/** Quem esta agindo numa rota administrativa, ja resolvido contra o banco. */
export interface AdminIdentity {
  userId: string;
  email: string;
  name: string;
  /** Papel no projeto do proprio SSO, lido de `ProjectUser`. Nome livre. */
  role: string;
  /**
   * `true` para o papel raiz do projeto `SSO`, que alcanca toda rota
   * administrativa sem depender do catalogo.
   */
  root: boolean;
  /**
   * `jti` do access token, ou `session:<id>` quando a identidade veio do
   * cookie. Serve para correlacionar log de auditoria.
   */
  tokenId: string;
  /**
   * Como a pessoa se identificou. `bearer` e a linha de comando e os testes;
   * `session` e o console, e so ela exige token anti-CSRF na escrita.
   */
  via: 'bearer' | 'session';
  /** Copia legivel do token anti-CSRF. Presente apenas com `via: 'session'`. */
  csrfToken?: string;
}

export interface RequestWithAdmin extends Request {
  ssoAdmin?: AdminIdentity;
}
