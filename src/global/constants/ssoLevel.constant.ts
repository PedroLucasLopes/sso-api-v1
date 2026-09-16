/**
 * Niveis de acesso das rotas administrativas, lidos pelo `SSOAdminGuard`.
 *
 * Sao apenas dois. Tudo o que nao for `@Public()` exige um usuario
 * autenticado, e o que ele pode fazer sai da tabela `Permission` do projeto
 * do proprio SSO, nao de um nivel escrito no codigo. Papel novo, rota nova ou
 * permissao revogada nao pedem deploy.
 */
export const SSO_LEVEL_PUBLIC = 'isPublic';

/**
 * Exige identidade, dispensa permissao por rota. Para o punhado de rotas que
 * so devolvem o que ja e do proprio usuario, como `/sso/me`.
 */
export const SSO_LEVEL_AUTHENTICATED = 'isAuthenticated';
