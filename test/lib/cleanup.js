/*
 * Remove do banco o que uma suite de teste criou.
 *
 * Existe porque os testes rodam contra o banco de desenvolvimento de verdade,
 * e nao contra um descartavel. Sem isto, cada rodada deixava um projeto orfao
 * e, pior, um usuario com papel SUPERADMIN no projeto do proprio SSO.
 *
 * Apaga por ID e por e-mail exatos, nunca por padrao: uma limpeza que aceita
 * curinga e uma que um dia apaga dado real.
 */

/** Ordem das tabelas ditada pelas chaves estrangeiras. */
async function removerUsuarios(db, emails) {
  if (!emails.length) return 0;

  const { rows } = await db.query(
    'SELECT id FROM "User" WHERE email = ANY($1)',
    [emails],
  );

  const ids = rows.map((linha) => linha.id);

  if (!ids.length) return 0;

  await db.query(
    `DELETE FROM "RefreshToken"
      WHERE "authSessionId" IN (SELECT id FROM "AuthSession" WHERE "userId" = ANY($1))`,
    [ids],
  );
  await db.query(
    `DELETE FROM "AuthorizationCode"
      WHERE "authSessionId" IN (SELECT id FROM "AuthSession" WHERE "userId" = ANY($1))`,
    [ids],
  );
  await db.query('DELETE FROM "AuthSession" WHERE "userId" = ANY($1)', [ids]);
  await db.query('DELETE FROM "ProjectUser" WHERE "userId" = ANY($1)', [ids]);
  await db.query('DELETE FROM "User" WHERE id = ANY($1)', [ids]);

  return ids.length;
}

async function removerProjetos(db, ids) {
  if (!ids.length) return 0;

  await db.query('DELETE FROM "RefreshToken" WHERE "projectId" = ANY($1)', [ids]);
  await db.query('DELETE FROM "AuthorizationCode" WHERE "projectId" = ANY($1)', [ids]);
  await db.query(
    `DELETE FROM "Permission"
      WHERE "roleId" IN (SELECT id FROM "Role" WHERE "projectId" = ANY($1))`,
    [ids],
  );
  await db.query('DELETE FROM "ProjectUser" WHERE "projectId" = ANY($1)', [ids]);
  await db.query('DELETE FROM "Role" WHERE "projectId" = ANY($1)', [ids]);
  await db.query('DELETE FROM "Route" WHERE "projectId" = ANY($1)', [ids]);
  await db.query('DELETE FROM "redirectUri" WHERE "projectId" = ANY($1)', [ids]);
  await db.query('DELETE FROM "ClientKey" WHERE "projectId" = ANY($1)', [ids]);
  await db.query('DELETE FROM "Project" WHERE id = ANY($1)', [ids]);

  return ids.length;
}

/**
 * @param {{ usuarios?: string[], projetos?: string[] }} alvo
 *        `usuarios` sao e-mails, `projetos` sao ids.
 */
async function limparTestes(db, alvo = {}) {
  const projetos = await removerProjetos(db, alvo.projetos ?? []);
  const usuarios = await removerUsuarios(db, alvo.usuarios ?? []);

  return { projetos, usuarios };
}

module.exports = { limparTestes };
