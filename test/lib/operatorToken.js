const crypto = require('node:crypto');

const SELF_PROJECT_NAME = 'SSO';

const NOW = "(now() AT TIME ZONE 'utc')";

const CLIENT_ASSERTION_TYPE =
  'urn:ietf:params:oauth:client-assertion-type:jwt-bearer';

const one = async (db, sql, params = []) =>
  (await db.query(sql, params)).rows[0];

function sealSessionCookie(cookieSecret, payload) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(
    'aes-256-gcm',
    Buffer.from(cookieSecret, 'hex'),
    iv,
  );

  const text = Buffer.concat([
    cipher.update(JSON.stringify(payload), 'utf8'),
    cipher.final(),
  ]);

  return [
    iv.toString('base64url'),
    cipher.getAuthTag().toString('base64url'),
    text.toString('base64url'),
  ].join('.');
}

async function selfProject(db) {
  const project = await one(
    db,
    'SELECT id, "clientId" FROM "Project" WHERE name = $1',
    [SELF_PROJECT_NAME],
  );

  if (!project) {
    throw new Error(
      `o projeto "${SELF_PROJECT_NAME}" nao existe no catalogo; ` +
        'rode o SQL de primeira subida do ambiente antes',
    );
  }

  return project;
}

async function ensureOperator(db, { email, name, role }) {
  const project = await selfProject(db);

  const roleRow = await one(
    db,
    'SELECT id FROM "Role" WHERE name = $1 AND "projectId" = $2',
    [role, project.id],
  );

  if (!roleRow) {
    throw new Error(
      `o papel ${role} nao existe no projeto do SSO`,
    );
  }

  let user = await one(db, 'SELECT id FROM "User" WHERE email = $1', [email]);

  if (!user) {
    user = await one(
      db,
      'INSERT INTO "User" (id, email, name) VALUES ($1, $2, $3) RETURNING id',
      [crypto.randomUUID(), email, name || email.split('@')[0]],
    );
  }

  await db.query(
    `INSERT INTO "ProjectUser" ("userId", "projectId", "roleId")
     VALUES ($1, $2, $3)
     ON CONFLICT ("userId", "projectId") DO UPDATE SET "roleId" = EXCLUDED."roleId"`,
    [user.id, project.id, roleRow.id],
  );

  return { userId: user.id, email, role };
}

function clientAssertion(clientId, privateKeyPem, tokenEndpoint) {
  const now = Math.floor(Date.now() / 1000);
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');

  const signingInput = `${b64({ alg: 'RS256', typ: 'JWT' })}.${b64({
    iss: clientId,
    sub: clientId,
    aud: tokenEndpoint,
    jti: crypto.randomUUID(),
    iat: now,
    exp: now + 60,
  })}`;

  const signature = crypto
    .sign('sha256', Buffer.from(signingInput), privateKeyPem)
    .toString('base64url');

  return `${signingInput}.${signature}`;
}

async function mintOperatorToken(db, { issuer, cookieSecret, email }) {
  const sso = issuer.replace(/\/+$/, '');
  const project = await selfProject(db);

  const redirect = await one(
    db,
    'SELECT "redirectUri" FROM "redirectUri" WHERE "projectId" = $1 ORDER BY "redirectUri" LIMIT 1',
    [project.id],
  );

  if (!redirect) {
    throw new Error('o projeto do SSO nao tem redirect_uri cadastrada');
  }

  const operator = await one(
    db,
    `SELECT u.id, u.email, r.name AS role
       FROM "User" u
       JOIN "ProjectUser" pu ON pu."userId" = u.id AND pu."projectId" = $1
       JOIN "Role" r ON r.id = pu."roleId"
      WHERE u.email = $2`,
    [project.id, email],
  );

  if (!operator) {
    throw new Error(
      `${email} nao tem papel no projeto do SSO`,
    );
  }

  const pair = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });

  const clientKeyId = crypto.randomUUID();
  const sessionId = crypto.randomUUID();

  const clean = async () => {
    await db.query('DELETE FROM "ClientKey" WHERE id = $1', [clientKeyId]);
    await db.query('DELETE FROM "RefreshToken" WHERE "authSessionId" = $1', [sessionId]);
    await db.query('DELETE FROM "AuthorizationCode" WHERE "authSessionId" = $1', [sessionId]);
    await db.query('DELETE FROM "AuthSession" WHERE id = $1', [sessionId]);
  };

  try {
    await db.query(
      `INSERT INTO "ClientKey" (id, "projectId", algorithm, "publicKeyPem", "createdAt", "expiresAt")
       VALUES ($1, $2, 'RS256', $3, ${NOW}, ${NOW} + interval '5 minutes')`,
      [clientKeyId, project.id, pair.publicKey],
    );

    await db.query(
      `INSERT INTO "AuthSession" (id, "userId", "expiresAt", "createdAt", "lastSeenAt")
       VALUES ($1, $2, ${NOW} + interval '5 minutes', ${NOW}, ${NOW})`,
      [sessionId, operator.id],
    );

    const verifier = crypto.randomBytes(32).toString('base64url');
    const challenge = crypto
      .createHash('sha256')
      .update(verifier, 'ascii')
      .digest('base64url');

    const query = new URLSearchParams({
      client_id: project.clientId,
      redirect_uri: redirect.redirectUri,
      response_type: 'code',
      code_challenge: challenge,
      code_challenge_method: 'S256',
      state: crypto.randomBytes(16).toString('base64url'),
    });

    const authorization = await fetch(`${sso}/oauth/authorize?${query}`, {
      redirect: 'manual',
      headers: {
        cookie: `sso_session=${sealSessionCookie(cookieSecret, { authSessionId: sessionId })}`,
      },
    });

    const local = authorization.headers.get('location');

    if (!local || !local.startsWith(redirect.redirectUri)) {
      throw new Error(
        `authorize nao devolveu o code (HTTP ${authorization.status}, location ${local ?? 'ausente'})`,
      );
    }

    const code = new URL(local).searchParams.get('code');

    if (!code) throw new Error(`authorize devolveu erro: ${local}`);

    const swap = await fetch(`${sso}/oauth/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'authorization_code',
        code,
        code_verifier: verifier,
        redirect_uri: redirect.redirectUri,
        client_assertion_type: CLIENT_ASSERTION_TYPE,
        client_assertion: clientAssertion(
          project.clientId,
          pair.privateKey,
          `${sso}/oauth/token`,
        ),
      }),
    });

    const body = await swap.json();

    if (!swap.ok || !body.access_token) {
      throw new Error(
        `token endpoint recusou: HTTP ${swap.status} ${JSON.stringify(body)}`,
      );
    }

    return {
      token: body.access_token,
      expiresIn: body.expires_in,
      role: operator.role,
      email: operator.email,
      userId: operator.id,
      clientId: project.clientId,
      projectId: project.id,
    };
  } finally {
    await clean().catch(() => {});
  }
}

module.exports = {
  SELF_PROJECT_NAME,
  ensureOperator,
  mintOperatorToken,
  sealSessionCookie,
  selfProject,
};
