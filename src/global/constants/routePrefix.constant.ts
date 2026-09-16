/**
 * Prefixo global da aplicacao, aplicado em `main.ts`.
 *
 * Vive numa constante porque o guard precisa remove-lo do caminho da
 * requisicao antes de comparar com a tabela `Route`, onde os caminhos sao
 * guardados sem prefixo: `/sso/project/:id` na URL e `/project/:id` no banco.
 */
export const SSO_ROUTE_PREFIX = 'sso';
