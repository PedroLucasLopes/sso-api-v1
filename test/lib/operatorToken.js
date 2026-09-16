/*
 * Emissao de access token administrativo percorrendo o fluxo OAuth de
 * verdade, a partir de acesso ao banco.
 *
 * Usado so pelos testes ponta a ponta, contra banco local: eles precisam de
 * uma credencial administrativa ligada a um usuario cadastrado, agora que
 * `x-sso-secret` deixou de existir. Nao ha linha de comando que o exponha.
 *
 * Nada aqui contorna a autorizacao. O token sai com o `sub` da pessoa e o
 * papel que ela tem em `ProjectUser`; quem nao administra o SSO recebe um
 * token que nao abre nenhuma rota. O privilegio exigido e acesso ao Postgres,
 * que por si so ja permite tudo.
 */
const crypto = require('node:crypto');

/* Mantenha igual a SSO_SELF_PROJECT_NAME em
 * src/global/constants/selfProject.constant.ts. */
const SELF_PROJECT_NAME = 'SSO';

/* Prisma le estas colunas como UTC e o `now()` do Postgres devolve hora
 * local. Sem o `AT TIME ZONE`, uma sessao criada aqui nasce expirada para o
 * servidor sempre que a maquina nao estiver em UTC. */
const AGORA = "(now() AT TIME ZONE 'utc')";

const CLIENT_ASSERTION_TYPE =
  'urn:ietf:params:oauth:client-assertion-type:jwt-bearer';

const uma = async (db, sql, params = []) =>
  (await db.query(sql, params)).rows[0];

/** Cookie de sessao do SSO, no mesmo formato do CookieService (AES-256-GCM). */
function sealSessionCookie(cookieSecret, payload) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(
    'aes-256-gcm',
    Buffer.from(cookieSecret, 'hex'),
    iv,
  );

  const texto = Buffer.concat([
    cipher.update(JSON.stringify(payload), 'utf8'),
    cipher.final(),
  ]);

  return [
    iv.toString('base64url'),
    cipher.getAuthTag().toString('base64url'),
    texto.toString('base64url'),
  ].join('.');
}

/** Projeto que representa o proprio SSO. Sem ele nao ha administracao. */
async function selfProject(db) {
  const projeto = await uma(
    db,
    'SELECT id, "clientId" FROM "Project" WHERE name = $1',
    [SELF_PROJECT_NAME],
  );

  if (!projeto) {
    throw new Error(
      `o projeto "${SELF_PROJECT_NAME}" nao existe no catalogo; ` +
        'rode o SQL de primeira subida do ambiente antes',
    );
  }

  return projeto;
}

/**
 * Garante que um usuario existe e tem `papel` no projeto do SSO.
 *
 * Existe para os testes, que precisam de um operador proprio em vez de
 * depender do e-mail pessoal de quem administra o ambiente. O papel ja tem de
 * existir no projeto do SSO: os padroes nascem com ele, e um papel customizado
 * o teste cria antes, pela API.
 */
async function ensureOperator(db, { email, name, role }) {
  const projeto = await selfProject(db);

  const papel = await uma(
    db,
    'SELECT id FROM "Role" WHERE name = $1 AND "projectId" = $2',
    [role, projeto.id],
  );

  if (!papel) {
    throw new Error(
      `o papel ${role} nao existe no projeto do SSO`,
    );
  }

  let usuario = await uma(db, 'SELECT id FROM "User" WHERE email = $1', [email]);

  if (!usuario) {
    usuario = await uma(
      db,
      'INSERT INTO "User" (id, email, name) VALUES ($1, $2, $3) RETURNING id',
      [crypto.randomUUID(), email, name || email.split('@')[0]],
    );
  }

  await db.query(
    `INSERT INTO "ProjectUser" ("userId", "projectId", "roleId")
     VALUES ($1, $2, $3)
     ON CONFLICT ("userId", "projectId") DO UPDATE SET "roleId" = EXCLUDED."roleId"`,
    [usuario.id, projeto.id, papel.id],
  );

  return { userId: usuario.id, email, role };
}

/** Asercao de cliente do `private_key_jwt` (RFC 7523 secao 2.2). */
function clientAssertion(clientId, privateKeyPem, tokenEndpoint) {
  const agora = Math.floor(Date.now() / 1000);
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');

  const entrada = `${b64({ alg: 'RS256', typ: 'JWT' })}.${b64({
    iss: clientId,
    sub: clientId,
    aud: tokenEndpoint,
    jti: crypto.randomUUID(),
    iat: agora,
    exp: agora + 60,
  })}`;

  const assinatura = crypto
    .sign('sha256', Buffer.from(entrada), privateKeyPem)
    .toString('base64url');

  return `${entrada}.${assinatura}`;
}

/**
 * Emite um access token para `email`, que precisa ja ter papel no projeto do
 * SSO. A chave de cliente criada para assinar a assercao e a sessao usada no
 * caminho sao desfeitas antes de retornar.
 */
async function mintOperatorToken(db, { issuer, cookieSecret, email }) {
  const sso = issuer.replace(/\/+$/, '');
  const projeto = await selfProject(db);

  const redirect = await uma(
    db,
    'SELECT "redirectUri" FROM "redirectUri" WHERE "projectId" = $1 ORDER BY "redirectUri" LIMIT 1',
    [projeto.id],
  );

  if (!redirect) {
    throw new Error('o projeto do SSO nao tem redirect_uri cadastrada');
  }

  const operador = await uma(
    db,
    `SELECT u.id, u.email, r.name AS papel
       FROM "User" u
       JOIN "ProjectUser" pu ON pu."userId" = u.id AND pu."projectId" = $1
       JOIN "Role" r ON r.id = pu."roleId"
      WHERE u.email = $2`,
    [projeto.id, email],
  );

  if (!operador) {
    throw new Error(
      `${email} nao tem papel no projeto do SSO`,
    );
  }

  const par = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });

  const clientKeyId = crypto.randomUUID();
  const sessionId = crypto.randomUUID();

  /* Apaga tudo o que esta emissao criou. Revogar a sessao bastaria para a
   * seguranca, mas a linha ficaria: emitir um token pela linha de comando nao
   * e um login de usuario e nao deve virar historico de sessao. */
  const limpar = async () => {
    await db.query('DELETE FROM "ClientKey" WHERE id = $1', [clientKeyId]);
    await db.query('DELETE FROM "RefreshToken" WHERE "authSessionId" = $1', [sessionId]);
    await db.query('DELETE FROM "AuthorizationCode" WHERE "authSessionId" = $1', [sessionId]);
    await db.query('DELETE FROM "AuthSession" WHERE id = $1', [sessionId]);
  };

  try {
    await db.query(
      `INSERT INTO "ClientKey" (id, "projectId", algorithm, "publicKeyPem", "createdAt", "expiresAt")
       VALUES ($1, $2, 'RS256', $3, ${AGORA}, ${AGORA} + interval '5 minutes')`,
      [clientKeyId, projeto.id, par.publicKey],
    );

    await db.query(
      `INSERT INTO "AuthSession" (id, "userId", "expiresAt", "createdAt", "lastSeenAt")
       VALUES ($1, $2, ${AGORA} + interval '5 minutes', ${AGORA}, ${AGORA})`,
      [sessionId, operador.id],
    );

    const verifier = crypto.randomBytes(32).toString('base64url');
    const challenge = crypto
      .createHash('sha256')
      .update(verifier, 'ascii')
      .digest('base64url');

    const query = new URLSearchParams({
      client_id: projeto.clientId,
      redirect_uri: redirect.redirectUri,
      response_type: 'code',
      code_challenge: challenge,
      code_challenge_method: 'S256',
      state: crypto.randomBytes(16).toString('base64url'),
    });

    const autorizacao = await fetch(`${sso}/oauth/authorize?${query}`, {
      redirect: 'manual',
      headers: {
        cookie: `sso_session=${sealSessionCookie(cookieSecret, { authSessionId: sessionId })}`,
      },
    });

    const local = autorizacao.headers.get('location');

    if (!local || !local.startsWith(redirect.redirectUri)) {
      throw new Error(
        `authorize nao devolveu o code (HTTP ${autorizacao.status}, location ${local ?? 'ausente'})`,
      );
    }

    const code = new URL(local).searchParams.get('code');

    if (!code) throw new Error(`authorize devolveu erro: ${local}`);

    const troca = await fetch(`${sso}/oauth/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'authorization_code',
        code,
        code_verifier: verifier,
        redirect_uri: redirect.redirectUri,
        client_assertion_type: CLIENT_ASSERTION_TYPE,
        client_assertion: clientAssertion(
          projeto.clientId,
          par.privateKey,
          `${sso}/oauth/token`,
        ),
      }),
    });

    const corpo = await troca.json();

    if (!troca.ok || !corpo.access_token) {
      throw new Error(
        `token endpoint recusou: HTTP ${troca.status} ${JSON.stringify(corpo)}`,
      );
    }

    return {
      token: corpo.access_token,
      expiresIn: corpo.expires_in,
      role: operador.papel,
      email: operador.email,
      userId: operador.id,
      clientId: projeto.clientId,
      projectId: projeto.id,
    };
  } finally {
    await limpar().catch(() => {});
  }
}

module.exports = {
  SELF_PROJECT_NAME,
  ensureOperator,
  mintOperatorToken,
  sealSessionCookie,
  selfProject,
};
