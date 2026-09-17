/**
 * Papeis com que todo projeto nasce. Sao so nomes: nascem sem permissao
 * nenhuma, e o que cada um alcanca e marcado depois, rota por rota.
 *
 * `SUPERADMIN` aqui nao da poder nenhum. A raiz e o SUPERADMIN do projeto
 * `SSO`, conferido por nome de projeto em `AdminAccessService`, e `Project.name`
 * e unico: nenhum projeto novo se passa por ele.
 */
export const DEFAULT_ROLE_NAMES = [
  'SUPERADMIN',
  'ADMIN',
  'MANAGER',
  'VIEWER',
] as const;

/**
 * Nome de papel: comeca por letra maiuscula e segue com maiusculas, digitos ou
 * `_`, de 2 a 40 caracteres. Vai dentro do access token, na claim `roles`.
 */
export const ROLE_NAME_PATTERN = /^[A-Z][A-Z0-9_]{1,39}$/;
