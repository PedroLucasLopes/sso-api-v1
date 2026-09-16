/**
 * Resposta do token endpoint (RFC 6749 secao 5.1).
 *
 * `expires_in` e o tempo de vida em SEGUNDOS, como numero. A implementacao
 * anterior devolvia a string do .env (`"15d"`), o que nenhum cliente OAuth
 * generico consegue interpretar.
 */
export class TokenResponse {
  access_token: string;
  token_type: 'Bearer';
  expires_in: number;
  refresh_token: string;
  scope?: string;
}

/**
 * Claims do access token.
 *
 * `aud` amarra o token a um unico cliente, o que a RFC 9700 secao 2.3 pede:
 * token vazado de um projeto nao vale em outro. `jti` da identidade unica
 * para revogacao e para log de auditoria.
 */
export class AccessTokenClaims {
  iss: string;
  sub: string;
  aud: string;
  jti: string;
  email: string;
  name: string;
  clientId: string;
  /**
   * Papeis do usuario neste projeto (RFC 9068 secao 2.2.3.1, com o nome de
   * atributo do SCIM). NAO carrega a lista de rotas: ela cresceria com o
   * projeto e ja estourou o limite de cookie do navegador uma vez.
   */
  roles: string[];
  /** Impressao digital do conjunto de permissoes, chave de cache do cliente. */
  perm: string;
}
