/**
 * Nome do `Project` que representa o proprio SSO dentro do seu catalogo.
 *
 * O console administrativo e uma aplicacao como qualquer outra: entra pelo
 * fluxo OAuth, recebe um access token com `aud` igual ao `clientId` deste
 * projeto, e o que ele pode fazer sai de `ProjectUser` -> `Role` ->
 * `Permission`. E o que permite tirar `SSO_ADMIN_SECRET` do ambiente: quem
 * administra passa a ser um usuario do banco, com nome, papel e revogacao
 * individual, em vez de todo mundo que conhece um segredo compartilhado.
 *
 * `Project.name` e unico, entao serve de chave estavel.
 *
 * O projeto nasce pelo SQL de primeira subida de cada ambiente, junto do
 * primeiro SUPERADMIN. Nao ha script nem seed no repositorio que o crie.
 */
export const SSO_SELF_PROJECT_NAME = 'SSO';

/**
 * Papel raiz do projeto `SSO`. Quem o tem alcanca toda rota administrativa sem
 * depender do catalogo: e o que permite, num banco novo, cadastrar a primeira
 * rota. Nenhuma rota fica ligada a papel no codigo; esta e a unica regra de
 * acesso escrita aqui.
 */
export const SSO_ROOT_ROLE = 'SUPERADMIN';
