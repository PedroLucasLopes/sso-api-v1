/**
 * Pedido de login de uma aplicacao cliente, guardado no cookie `sso_tx` cifrado.
 *
 * Antes isto vivia no Redis sob a chave `pkce:{state}`, com o `state` vindo
 * do cliente. Como o `state` e escolhido por quem chama, dava para colidir ou
 * sobrescrever a transacao de outra pessoa. No cookie o vinculo passa a ser
 * com o navegador, que e o que a RFC 9700 secao 2.1 exige.
 */
export class PkceTransaction {
  /** Ausente em cookie emitido antes de existir a tela de login do front. */
  kind?: 'authorize';
  projectId: string;
  clientId: string;
  /** Nome da aplicacao, para a tela de login dizer onde a pessoa vai entrar. */
  projectName?: string;
  redirectUri: string;
  codeChallenge: string;
  codeChallengeMethod: string;
  state: string;
  /**
   * Nonce nosso, enviado ao Google como `state` e conferido no callback.
   *
   * Sem ele o trecho SSO -> Google fica sem protecao de CSRF: um atacante
   * poderia injetar o proprio authorization code do Google no callback da
   * vitima e faze-la entrar como ele. O cookie de transacao sozinho nao
   * cobre isso, porque nao amarra a uma requisicao especifica ao provedor.
   */
  googleNonce: string;
  /** Epoch em segundos. Checado no callback alem do maxAge do cookie. */
  createdAt: number;
}

/**
 * Pedido de login do proprio console do SSO.
 *
 * O console entra como qualquer aplicacao: sem sessao, manda a pessoa ao SSO
 * com a `redirect_uri` registrada no projeto `SSO`. O que muda e a volta. O
 * console fala com a API na mesma origem e se autentica pela sessao do SSO
 * (RFC 10017 secao 7.1), entao nao ha code a emitir nem token a trocar: ele
 * recebe de volta so o `state`, para conferir que o retorno e dele.
 */
export class SessionTransaction {
  kind: 'session';
  projectId: string;
  projectName: string;
  redirectUri: string;
  state: string;
  googleNonce: string;
  createdAt: number;
}

export type LoginTransaction = PkceTransaction | SessionTransaction;

/** Conteudo do cookie `sso_session`: a sessao do usuario com o proprio SSO. */
export class SsoSessionCookie {
  authSessionId: string;
  /**
   * Token anti-CSRF da escrita autenticada por sessao. A copia que vale mora
   * aqui dentro, cifrada; o console recebe a legivel em `GET /sso/me` e a
   * devolve no header `X-CSRF-Token`. Sessao criada antes disto chega sem ele
   * e ganha um na primeira chamada autenticada.
   */
  csrf?: string;
}
