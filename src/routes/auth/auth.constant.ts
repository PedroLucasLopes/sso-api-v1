/** Pedido de login em curso. Vive entre a aplicacao que pediu e o callback. */
export const SSO_TX_COOKIE = 'sso_tx';

/** Sessao do usuario com o SSO. E o que dispensa refazer o login no Google. */
export const SSO_SESSION_COOKIE = 'sso_session';

/** Vida do cookie de transacao. Curta: e so a ida e volta ao provedor. */
export const TX_COOKIE_TTL_SECONDS = 300;

/**
 * Header da copia legivel do token anti-CSRF.
 *
 * O console do SSO se autentica pelo cookie de sessao, que o navegador anexa
 * sozinho, inclusive quando outro site dispara a requisicao. A escrita so passa
 * com este header igual ao token guardado DENTRO do cookie cifrado, que um
 * atacante nao consegue ler nem forjar.
 */
export const SSO_CSRF_HEADER = 'x-csrf-token';

/**
 * O que a tela de login do front sabe explicar.
 *
 * Viaja na query string como CODIGO, nunca como texto livre. Mensagem lida da
 * URL e vetor classico de phishing ("sua conta foi bloqueada, ligue para..."):
 * o front traduz o codigo, e o que ele nao reconhece vira mensagem generica.
 */
export type LoginErrorCode =
  | 'no_pending_request'
  | 'request_expired'
  | 'account_not_registered'
  | 'email_not_verified'
  | 'account_mismatch'
  | 'provider_denied'
  | 'provider_error';
