async function removeUsers(db, emails) {
  if (!emails.length) return 0;

  const { rows } = await db.query(
    'SELECT id FROM "User" WHERE email = ANY($1)',
    [emails],
  );

  const ids = rows.map((line) => line.id);

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

async function removeProjects(db, ids) {
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

async function cleanTests(db, target = {}) {
  const projects = await removeProjects(db, target.projects ?? []);
  const users = await removeUsers(db, target.users ?? []);

  return { projects, users };
}

module.exports = { cleanTests };
