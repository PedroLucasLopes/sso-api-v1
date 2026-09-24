const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const { Client } = require('pg');
const {
  ensureOperator,
  mintOperatorToken,
} = require('./lib/operatorToken');
const { cleanTests } = require('./lib/cleanup');

const BASE = process.env.SSO_ISSUER || 'http://localhost:8080/sso';
const REPO_DIR = path.resolve(__dirname, '..');

const readEnv = (file) => {
  if (!fs.existsSync(file)) return {};
  return Object.fromEntries(
    fs
      .readFileSync(file, 'utf8')
      .split(/\r?\n/)
      .filter((l) => /^\s*[A-Za-z0-9_]+=/.test(l))
      .map((l) => {
        const i = l.indexOf('=');
        return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
      }),
  );
};

const env = readEnv(path.join(REPO_DIR, '.env.docker'));

const HOSTS_LOCAIS = new Set(['localhost', '127.0.0.1', 'host.docker.internal']);
const databaseHost = (() => {
  try {
    return new URL(env.DATABASE_URL).hostname;
  } catch {
    return '';
  }
})();

if (!HOSTS_LOCAIS.has(databaseHost)) {
  console.error('\nEste teste so roda contra banco local. Confira o DATABASE_URL do .env.docker.\n');
  process.exit(1);
}

const ADMIN = { 'content-type': 'application/json' };

const OPERATOR = 'e2e-superadmin@exemplo.com';
const READER = 'e2e-leitor@exemplo.com';
const MANAGER = 'e2e-gestor@exemplo.com';
const COOKIE_KEY = Buffer.from(env.COOKIE_SECRET, 'hex');

const db = new Client({
  connectionString: env.DATABASE_URL.replace('host.docker.internal', '127.0.0.1'),
});

const run = {
  projects: [],
  users: [OPERATOR, READER, MANAGER],
  ssoRoles: [],
  ssoRoleNames: [],
  ssoRoutes: [],
  ssoRoutePaths: [],
  ssoUris: [],
};

async function cleanRun() {
  const cleaned = await cleanTests(db, {
    projects: run.projects.filter(Boolean),
    users: run.users.filter(Boolean),
  });

  const sso = (await db.query(`SELECT id FROM "Project" WHERE name = 'SSO'`)).rows[0];

  if (sso) {
    const roles = [sso.id, run.ssoRoles.filter(Boolean), run.ssoRoleNames];
    const routes = [sso.id, run.ssoRoutes.filter(Boolean), run.ssoRoutePaths];

    await db.query('DELETE FROM "redirectUri" WHERE "projectId" = $1 AND id = ANY($2)',
      [sso.id, run.ssoUris.filter(Boolean)]);
    await db.query(
      `DELETE FROM "Permission" WHERE "roleId" IN
         (SELECT id FROM "Role" WHERE "projectId" = $1 AND (id = ANY($2) OR name = ANY($3)))`, roles);
    await db.query('DELETE FROM "Role" WHERE "projectId" = $1 AND (id = ANY($2) OR name = ANY($3))', roles);
    await db.query(
      `DELETE FROM "Permission" WHERE "routeId" IN
         (SELECT id FROM "Route" WHERE "projectId" = $1 AND (id = ANY($2) OR path = ANY($3)))`, routes);
    await db.query('DELETE FROM "Route" WHERE "projectId" = $1 AND (id = ANY($2) OR path = ANY($3))', routes);
  }

  return cleaned;
}

let pass = 0;
let fail = 0;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? '  OK  ' : ' FALHA'} | ${name}${detail ? ` -> ${detail}` : ''}`);
  ok ? pass++ : fail++;
};

const sealCookie = (obj) => {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', COOKIE_KEY, iv);
  const ct = Buffer.concat([c.update(JSON.stringify(obj), 'utf8'), c.final()]);
  return [iv.toString('base64url'), c.getAuthTag().toString('base64url'), ct.toString('base64url')].join('.');
};

const api = async (method, path, body, headers = ADMIN) => {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
    redirect: 'manual',
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* resposta vazia ou redirect */ }
  return { status: res.status, json, text, location: res.headers.get('location') };
};

const clientAssertion = (clientId, privateKeyPem, overrides = {}) => {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const payload = {
    iss: clientId, sub: clientId, aud: `${BASE}/oauth/token`,
    jti: crypto.randomUUID(), iat: now, exp: now + 60, ...overrides,
  };
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const signingInput = `${b64(header)}.${b64(payload)}`;
  const sig = crypto.sign('sha256', Buffer.from(signingInput), privateKeyPem).toString('base64url');
  return `${signingInput}.${sig}`;
};

const verifyWithJwks = async (token) => {
  const [h, p, s] = token.split('.');
  const header = JSON.parse(Buffer.from(h, 'base64url').toString());
  const { keys } = await (await fetch(`${BASE}/.well-known/jwks.json`)).json();
  const jwk = keys.find((k) => k.kid === header.kid);
  if (!jwk) return { ok: false, reason: 'kid nao encontrado no JWKS' };
  const pub = crypto.createPublicKey({ key: jwk, format: 'jwk' });
  const ok = crypto.verify('sha256', Buffer.from(`${h}.${p}`), pub, Buffer.from(s, 'base64url'));
  return { ok, header, payload: JSON.parse(Buffer.from(p, 'base64url').toString()) };
};

(async () => {
  await db.connect();

  console.log('\n=== credencial administrativa ===');

  await ensureOperator(db, { email: OPERATOR, name: 'E2E Superadmin', role: 'SUPERADMIN' });

  const superadmin = await mintOperatorToken(db, {
    issuer: BASE, cookieSecret: env.COOKIE_SECRET, email: OPERATOR,
  });

  ADMIN.authorization = `Bearer ${superadmin.token}`;

  check('token administrativo sai do fluxo OAuth, com papel do banco',
    superadmin.role === 'SUPERADMIN' && !!superadmin.token, superadmin.role);

  const tag = crypto.randomBytes(4).toString('hex');
  const TAG = tag.toUpperCase();
  const REDIRECT = `http://localhost:3000/api/auth/callback`;

  console.log('\n=== preparo ===');
  const project = await api('POST', '/project', { name: `krloc-${tag}` });
  check('POST /project devolve o clientId gerado', !!project.json?.clientId,
    project.json?.clientId ? `${project.json.clientId.slice(0, 12)}...` : JSON.stringify(project.json));
  const projectId = project.json.id;
  const clientId = project.json.clientId;
  run.projects.push(projectId);

  const projectRoles = (await api('GET', `/project/${projectId}/overview`)).json?.roles ?? [];
  check('projeto novo nasce com os papeis padrao SUPERADMIN, ADMIN, MANAGER e VIEWER',
    JSON.stringify(projectRoles.map((r) => r.name).sort())
      === JSON.stringify(['ADMIN', 'MANAGER', 'SUPERADMIN', 'VIEWER']),
    JSON.stringify(projectRoles.map((r) => r.name)));
  check('os papeis padrao nascem sem permissao nenhuma',
    projectRoles.length === 4 && projectRoles.every((r) => r.permissions.length === 0));

  const roleAdmin = projectRoles.find((r) => r.name === 'ADMIN');

  await api('POST', '/redirecturi', { projectId, redirectUri: REDIRECT });
  const route = await api('POST', '/route', { path: '/equipment', method: 'GET', projectId });
  await api('POST', '/permission', { roleId: roleAdmin.id, routeId: route.json.id });
  run.users.push(`teste-${tag}@exemplo.com`);
  const user = await api('POST', '/user', { name: 'Teste', email: `teste-${tag}@exemplo.com` });
  await api('POST', '/projectuser', { userId: user.json.id, projectId, roleId: roleAdmin.id });

  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  const keyRes = await api('POST', '/clientkey', { projectId, publicKeyPem: publicKey });
  check('POST /clientkey aceita chave RSA 2048', keyRes.status === 201, `HTTP ${keyRes.status}`);

  const weak = crypto.generateKeyPairSync('rsa', {
    modulusLength: 1024,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  const weakRes = await api('POST', '/clientkey', { projectId, publicKeyPem: weak.publicKey });
  check('POST /clientkey recusa chave de 1024 bits', weakRes.status === 400, `HTTP ${weakRes.status}`);

  console.log('\n=== erro sai com codigo; o texto do servidor nao e o contrato ===');

  check('recusa de negocio vem com codigo', weakRes.json?.error === 'public_key_too_short',
    String(weakRes.json?.error));

  const missingProject = await api('GET', `/project/${crypto.randomUUID()}`);
  check('registro que nao existe vem com codigo e status no corpo',
    missingProject.status === 404 && missingProject.json?.error === 'project_not_found'
      && missingProject.json?.statusCode === 404,
    `HTTP ${missingProject.status} ${missingProject.json?.error}`);

  const badName = `papel ${tag} <b>`;
  const badRole = await api('POST', '/role', { name: badName, projectId });
  check('validacao do DTO vem como validation_failed, com o codigo do campo',
    badRole.status === 400 && badRole.json?.error === 'validation_failed'
      && badRole.json?.fields?.some((f) => f.field === 'name' && f.error === 'role_name_invalid'),
    JSON.stringify(badRole.json?.fields?.map((f) => `${f.field}:${f.error}`)));
  check('a recusa da validacao nao repete o valor enviado', !badRole.text.includes(badName));

  const badEmail = await api('POST', '/user', { name: 'Sem email', email: 'nao-e-email' });
  check('campo sem regra propria vem com o codigo dele',
    badEmail.status === 400 && badEmail.json?.fields?.some((f) => f.field === 'email' && f.error === 'email_invalid'),
    JSON.stringify(badEmail.json?.fields?.map((f) => `${f.field}:${f.error}`)));

  console.log('\n=== o projeto nasce PENDING e nao pode usar o SSO ===');
  check('projeto criado vem com status PENDING', project.json?.status === 'PENDING', String(project.json?.status));

  const beforeActivation = await api(
    'GET',
    `/oauth/authorize?client_id=${clientId}&redirect_uri=${encodeURIComponent(REDIRECT)}&response_type=code&code_challenge_method=S256&state=x&code_challenge=${'a'.repeat(43)}`,
    null,
    {},
  );
  check('authorize recusa projeto nao ativado',
    beforeActivation.status === 400 && beforeActivation.json?.error === 'unauthorized_client',
    `HTTP ${beforeActivation.status} ${beforeActivation.json?.error ?? ''}`);

  const activated = await api('PATCH', `/project/${projectId}/status`, { status: 'ACTIVE' });
  check('administrador ativa o projeto', activated.json?.status === 'ACTIVE', `HTTP ${activated.status}`);

  const sessionId = crypto.randomUUID();
  await db.query(
    `INSERT INTO "AuthSession" (id, "userId", "expiresAt")
     VALUES ($1, $2, (now() AT TIME ZONE 'utc') + interval '1 hour')`,
    [sessionId, user.json.id],
  );
  const sessionCookie = `sso_session=${sealCookie({ authSessionId: sessionId })}`;

  console.log('\n=== authorize endpoint (RFC 6749 secao 4.1.2.1) ===');
  const unknown = await api('GET', `/oauth/authorize?client_id=inexistente&redirect_uri=${encodeURIComponent(REDIRECT)}`, null, {});
  check('client_id desconhecido NAO redireciona e usa formato RFC',
    unknown.status === 400 && unknown.json?.error === 'invalid_request',
    `HTTP ${unknown.status} ${JSON.stringify(unknown.json)}`);

  const badRedirect = await api('GET', `/oauth/authorize?client_id=${clientId}&redirect_uri=${encodeURIComponent('http://evil.example/cb')}`, null, {});
  check('redirect_uri nao registrada NAO redireciona',
    badRedirect.status === 400 && !badRedirect.location, `HTTP ${badRedirect.status}`);

  const verifier = crypto.randomBytes(32).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier, 'ascii').digest('base64url');
  const state = crypto.randomBytes(16).toString('base64url');
  const authorizeQs = (extra = {}) => {
    const q = new URLSearchParams({
      client_id: clientId, redirect_uri: REDIRECT, response_type: 'code',
      code_challenge: challenge, code_challenge_method: 'S256', state, ...extra,
    });
    return `/oauth/authorize?${q}`;
  };

  const plain = await api('GET', authorizeQs({ code_challenge_method: 'plain' }), null, { cookie: sessionCookie });
  check('code_challenge_method=plain e recusado via redirect',
    plain.status === 302 && plain.location?.includes('error=invalid_request'),
    `HTTP ${plain.status}`);

  const badType = await api('GET', authorizeQs({ response_type: 'token' }), null, { cookie: sessionCookie });
  check('response_type=token volta unsupported_response_type pela redirect_uri',
    badType.location?.includes('error=unsupported_response_type'), badType.location ?? '');

  const issOf = (location) => (location ? new URL(location).searchParams.get('iss') : null);
  check('erro devolvido pela redirect_uri tambem traz iss (RFC 9207 secao 2)',
    issOf(badType.location) === BASE, issOf(badType.location) ?? 'ausente');

  run.users.push(`sem-papel-${tag}@exemplo.com`);
  const noRole = await api('POST', '/user', { name: 'Sem papel', email: `sem-papel-${tag}@exemplo.com` });
  const sessionNoMembership = crypto.randomUUID();
  await db.query(
    `INSERT INTO "AuthSession" (id, "userId", "expiresAt")
     VALUES ($1, $2, (now() AT TIME ZONE 'utc') + interval '1 hour')`,
    [sessionNoMembership, noRole.json.id],
  );
  const denied = await api('GET', authorizeQs(), null, {
    cookie: `sso_session=${sealCookie({ authSessionId: sessionNoMembership })}`,
  });
  const deniedReturn = denied.location ? new URL(denied.location) : null;
  check('sem papel no projeto, access_denied volta pela redirect_uri com state e iss',
    denied.status === 302
      && deniedReturn?.searchParams.get('error') === 'access_denied'
      && deniedReturn?.searchParams.get('state') === state
      && deniedReturn?.searchParams.get('iss') === BASE,
    denied.location ?? `HTTP ${denied.status}`);

  const authorized = await api('GET', authorizeQs(), null, { cookie: sessionCookie });
  const loc = new URL(authorized.location);
  const code = loc.searchParams.get('code');
  check('sessao viva emite code sem passar pelo Google', !!code, `HTTP ${authorized.status}`);
  check('state e devolvido intacto', loc.searchParams.get('state') === state);
  check('parametro iss presente (RFC 9207, anti mix-up)', loc.searchParams.get('iss') === BASE,
    loc.searchParams.get('iss') ?? 'ausente');

  const metadata = await (await fetch(`${BASE}/.well-known/oauth-authorization-server`)).json();
  check('discovery anuncia authorization_response_iss_parameter_supported (RFC 9207 secao 2.3)',
    metadata.authorization_response_iss_parameter_supported === true,
    String(metadata.authorization_response_iss_parameter_supported));
  check('issuer do discovery identico ao iss do sucesso e do erro (RFC 9207 secao 2.3)',
    metadata.issuer === loc.searchParams.get('iss') && metadata.issuer === deniedReturn?.searchParams.get('iss'),
    `${metadata.issuer} | ${deniedReturn?.searchParams.get('iss') ?? 'ausente'}`);

  console.log('\n=== token endpoint ===');
  const form = (o) => ({ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(o) });
  const tokenReq = async (o) => {
    const r = await fetch(`${BASE}/oauth/token`, form(o));
    return { status: r.status, json: await r.json().catch(() => null), cacheControl: r.headers.get('cache-control'), wwwAuth: r.headers.get('www-authenticate') };
  };

  const noAuth = await tokenReq({ grant_type: 'authorization_code', code, code_verifier: verifier, redirect_uri: REDIRECT });
  check('sem client_assertion devolve invalid_client 401',
    noAuth.status === 401 && noAuth.json?.error === 'invalid_client', `HTTP ${noAuth.status}`);
  check('erro 401 traz WWW-Authenticate', !!noAuth.wwwAuth, noAuth.wwwAuth ?? 'ausente');

  const wrongKey = crypto.generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } });
  const badAssert = await tokenReq({
    grant_type: 'authorization_code', code, code_verifier: verifier, redirect_uri: REDIRECT,
    client_assertion_type: 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer',
    client_assertion: clientAssertion(clientId, wrongKey.privateKey),
  });
  check('assercao assinada com chave errada e recusada',
    badAssert.status === 401 && badAssert.json?.error === 'invalid_client', `HTTP ${badAssert.status}`);

  const wrongVerifier = await tokenReq({
    grant_type: 'authorization_code', code, code_verifier: crypto.randomBytes(32).toString('base64url'), redirect_uri: REDIRECT,
    client_assertion_type: 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer',
    client_assertion: clientAssertion(clientId, privateKey),
  });
  check('code_verifier errado devolve invalid_grant (PKCE)',
    wrongVerifier.status === 400 && wrongVerifier.json?.error === 'invalid_grant',
    `${wrongVerifier.json?.error}: ${wrongVerifier.json?.error_description}`);

  const unknownGrant = await tokenReq({ grant_type: 'password', username: 'x', password: 'y' });
  check('grant_type desconhecido devolve unsupported_grant_type (RFC 6749 secao 5.2)',
    unknownGrant.status === 400 && unknownGrant.json?.error === 'unsupported_grant_type'
      && unknownGrant.cacheControl === 'no-store',
    `HTTP ${unknownGrant.status} ${unknownGrant.json?.error}`);

  const noGrant = await tokenReq({ code, redirect_uri: REDIRECT });
  check('corpo sem grant_type devolve invalid_request',
    noGrant.status === 400 && noGrant.json?.error === 'invalid_request'
      && typeof noGrant.json?.error_description === 'string',
    `HTTP ${noGrant.status} ${noGrant.json?.error}`);

  const fresh = await api('GET', authorizeQs(), null, { cookie: sessionCookie });
  const code2 = new URL(fresh.location).searchParams.get('code');

  const ok = await tokenReq({
    grant_type: 'authorization_code', code: code2, code_verifier: verifier, redirect_uri: REDIRECT,
    client_assertion_type: 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer',
    client_assertion: clientAssertion(clientId, privateKey),
  });
  check('troca valida devolve 200', ok.status === 200,
    ok.status === 200 ? 'HTTP 200' : `HTTP ${ok.status} ${JSON.stringify(ok.json)}`);
  check('Cache-Control: no-store (RFC 6749 secao 5.1)', ok.cacheControl === 'no-store', ok.cacheControl ?? 'ausente');
  check('expires_in e NUMERO em segundos', typeof ok.json?.expires_in === 'number', String(ok.json?.expires_in));
  check('token_type Bearer', ok.json?.token_type === 'Bearer');
  check('refresh_token emitido', typeof ok.json?.refresh_token === 'string');

  const v = await verifyWithJwks(ok.json.access_token);
  check('access_token verifica contra o JWKS publicado', v.ok);
  check('header traz alg RS256 e kid', v.header?.alg === 'RS256' && !!v.header?.kid, `alg=${v.header?.alg}`);
  check('claim iss correta', v.payload?.iss === BASE, v.payload?.iss);
  check('claim aud amarra o token ao cliente', v.payload?.aud === clientId);
  check('claim jti presente', !!v.payload?.jti);
  check('claim roles presente (RFC 9068)', JSON.stringify(v.payload?.roles) === JSON.stringify(['ADMIN']),
    JSON.stringify(v.payload?.roles));
  check('claim perm (hash do conjunto) presente', typeof v.payload?.perm === 'string' && v.payload.perm.length === 12,
    v.payload?.perm);
  check('a lista enumerada de rotas NAO vai no token', v.payload?.permissions === undefined);
  check('access token cabe no orcamento de cookie do navegador',
    ok.json.access_token.length < 2000, `${ok.json.access_token.length} bytes`);

  const permRes = await fetch(`${BASE}/oauth/permissions`, form({
    role: 'ADMIN',
    client_assertion_type: 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer',
    client_assertion: clientAssertion(clientId, privateKey),
  }));
  const permSet = permRes.ok ? await permRes.json() : null;
  check('POST /oauth/permissions resolve o papel', permRes.status === 200, `HTTP ${permRes.status}`);
  check('devolve as rotas do papel', JSON.stringify(permSet?.permissions) === JSON.stringify([{ path: '/equipment', method: 'GET' }]),
    JSON.stringify(permSet?.permissions));
  check('hash bate com a claim perm do token', permSet?.hash === v.payload?.perm,
    `${permSet?.hash} vs ${v.payload?.perm}`);

  const noClientAuth = await fetch(`${BASE}/oauth/permissions`, form({ role: 'ADMIN' }));
  check('permissions exige autenticacao de cliente', noClientAuth.status === 401, `HTTP ${noClientAuth.status}`);
  const lifetime = v.payload.exp - v.payload.iat;
  check('access token curto (<= 15 min)', lifetime <= 900, `${lifetime}s`);

  console.log('\n=== introspeccao (RFC 7662): o que muda no SSO chega sem novo login ===');

  run.users.push(`introspeccao-${tag}@exemplo.com`);
  const inspected = await api('POST', '/user', { name: 'Introspeccao', email: `introspeccao-${tag}@exemplo.com` });
  await api('POST', '/projectuser', { userId: inspected.json.id, projectId, roleId: roleAdmin.id });
  const inspectedSession = crypto.randomUUID();
  await db.query(
    `INSERT INTO "AuthSession" (id, "userId", "expiresAt")
     VALUES ($1, $2, (now() AT TIME ZONE 'utc') + interval '1 hour')`,
    [inspectedSession, inspected.json.id],
  );
  const inspectedCookie = `sso_session=${sealCookie({ authSessionId: inspectedSession })}`;
  const assertion = () => ({
    client_assertion_type: 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer',
    client_assertion: clientAssertion(clientId, privateKey),
  });
  const inspectedPair = async () => {
    const authorizeRedirect = await api('GET', authorizeQs(), null, { cookie: inspectedCookie });
    const authCode = authorizeRedirect.location ? new URL(authorizeRedirect.location).searchParams.get('code') : null;
    return tokenReq({ grant_type: 'authorization_code', code: authCode, code_verifier: verifier, redirect_uri: REDIRECT, ...assertion() });
  };
  const introspect = async (token, authenticate = true) => {
    const r = await fetch(`${BASE}/oauth/introspect`, form({ token, token_type_hint: 'access_token', ...(authenticate ? assertion() : {}) }));
    return { status: r.status, json: await r.json().catch(() => null), cacheControl: r.headers.get('cache-control') };
  };

  const introspectionMetadata = await (await fetch(`${BASE}/.well-known/oauth-authorization-server`)).json();
  check('discovery anuncia introspection_endpoint (RFC 8414 secao 2)',
    introspectionMetadata.introspection_endpoint === `${BASE}/oauth/introspect`,
    String(introspectionMetadata.introspection_endpoint));

  const firstPair = await inspectedPair();
  const active = await introspect(firstPair.json?.access_token);
  check('token valido: active, com o papel e o sub da pessoa',
    active.status === 200 && active.json?.active === true
      && JSON.stringify(active.json?.roles) === JSON.stringify(['ADMIN'])
      && active.json?.sub === inspected.json.id && active.json?.client_id === clientId,
    JSON.stringify(active.json));
  check('resposta da introspeccao nao vai para cache', active.cacheControl === 'no-store', active.cacheControl ?? 'ausente');

  const roleViewer = projectRoles.find((r) => r.name === 'VIEWER');
  await api('PUT', `/projectuser/${projectId}/${inspected.json.id}`, { roleId: roleViewer.id });
  const afterSwap = await introspect(firstPair.json?.access_token);
  check('trocado o papel, a introspeccao ja responde o papel novo',
    afterSwap.json?.active === true && JSON.stringify(afterSwap.json?.roles) === JSON.stringify(['VIEWER']),
    JSON.stringify(afterSwap.json?.roles));
  check('e o perm do conjunto novo, diferente do que ficou no token',
    typeof afterSwap.json?.perm === 'string' && afterSwap.json.perm !== active.json?.perm,
    `${active.json?.perm} -> ${afterSwap.json?.perm}`);

  const renewed = await tokenReq({ grant_type: 'refresh_token', refresh_token: firstPair.json?.refresh_token, ...assertion() });
  const renewedClaims = renewed.json?.access_token ? (await verifyWithJwks(renewed.json.access_token)).payload : null;
  check('o token renovado ja sai com o papel novo',
    JSON.stringify(renewedClaims?.roles) === JSON.stringify(['VIEWER']), JSON.stringify(renewedClaims?.roles));

  const fromOtherClient = await introspect(ADMIN.authorization?.slice('Bearer '.length));
  check('token de outro cliente responde inativo, sem dizer mais nada (RFC 7662 secao 4)',
    fromOtherClient.status === 200 && JSON.stringify(fromOtherClient.json) === JSON.stringify({ active: false }),
    JSON.stringify(fromOtherClient.json));

  const garbage = await introspect('isto.nao.e-um-token');
  check('token que nao verifica responde inativo', garbage.status === 200 && garbage.json?.active === false, JSON.stringify(garbage.json));

  const noClient = await introspect(renewed.json?.access_token, false);
  check('introspeccao exige autenticacao de cliente (RFC 7662 secao 2.3)', noClient.status === 401, `HTTP ${noClient.status}`);

  await fetch(`${BASE}/oauth/revoke`, form({ token: renewed.json?.refresh_token, token_type_hint: 'refresh_token', ...assertion() }));
  const afterRevoke = await introspect(renewed.json?.access_token);
  check('revogado o grant, o access token dele fica inativo antes de expirar',
    afterRevoke.json?.active === false, JSON.stringify(afterRevoke.json));

  const secondPair = await inspectedPair();
  const beforeRemoval = await introspect(secondPair.json?.access_token);
  await api('DELETE', `/projectuser/${projectId}/${inspected.json.id}`);
  const afterRemoval = await introspect(secondPair.json?.access_token);
  check('tirada do projeto, a pessoa perde o token ativo na introspeccao seguinte',
    beforeRemoval.json?.active === true && afterRemoval.json?.active === false,
    `${beforeRemoval.json?.active} -> ${afterRemoval.json?.active}`);

  console.log('\n=== uso unico e deteccao de replay ===');
  const replay = await tokenReq({
    grant_type: 'authorization_code', code: code2, code_verifier: verifier, redirect_uri: REDIRECT,
    client_assertion_type: 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer',
    client_assertion: clientAssertion(clientId, privateKey),
  });
  check('reapresentar o code devolve invalid_grant',
    replay.status === 400 && replay.json?.error === 'invalid_grant', replay.json?.error_description);

  const revoked = await db.query(
    `SELECT count(*)::int AS n FROM "RefreshToken" WHERE "authSessionId" = $1 AND "revokedAt" IS NOT NULL`, [sessionId]);
  check('replay do code revoga os refresh tokens emitidos (RFC 9700 2.1.1)', revoked.rows[0].n > 0, `${revoked.rows[0].n} revogado(s)`);

  console.log('\n=== rotacao de refresh token ===');
  const fresh2 = await api('GET', authorizeQs(), null, { cookie: sessionCookie });
  const code3 = new URL(fresh2.location).searchParams.get('code');
  const pair1 = await tokenReq({
    grant_type: 'authorization_code', code: code3, code_verifier: verifier, redirect_uri: REDIRECT,
    client_assertion_type: 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer',
    client_assertion: clientAssertion(clientId, privateKey),
  });

  const refreshed = await tokenReq({
    grant_type: 'refresh_token', refresh_token: pair1.json.refresh_token,
    client_assertion_type: 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer',
    client_assertion: clientAssertion(clientId, privateKey),
  });
  check('refresh devolve novo par', refreshed.status === 200 && !!refreshed.json?.refresh_token, `HTTP ${refreshed.status}`);
  check('refresh token e rotacionado, nao reaproveitado',
    refreshed.json?.refresh_token !== pair1.json.refresh_token);

  const expiryOf = async (raw) =>
    (await db.query('SELECT "expiresAt"::text AS v FROM "RefreshToken" WHERE "tokenHash" = $1',
      [crypto.createHash('sha256').update(raw).digest('hex')])).rows[0]?.v;

  const originalCap = await expiryOf(pair1.json.refresh_token);
  const rotatedCap = await expiryOf(refreshed.json.refresh_token);

  check('a rotacao HERDA o vencimento, nao o estende (sessao nao vira eterna)',
    !!originalCap && originalCap === rotatedCap,
    `${originalCap} -> ${rotatedCap}`);

  const reuse = await tokenReq({
    grant_type: 'refresh_token', refresh_token: pair1.json.refresh_token,
    client_assertion_type: 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer',
    client_assertion: clientAssertion(clientId, privateKey),
  });
  check('reusar refresh token antigo devolve invalid_grant',
    reuse.status === 400 && reuse.json?.error === 'invalid_grant', reuse.json?.error_description);

  const afterReuse = await tokenReq({
    grant_type: 'refresh_token', refresh_token: refreshed.json.refresh_token,
    client_assertion_type: 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer',
    client_assertion: clientAssertion(clientId, privateKey),
  });
  check('deteccao de reuso derruba a familia inteira',
    afterReuse.status === 400, `HTTP ${afterReuse.status} ${afterReuse.json?.error ?? ''}`);

  console.log('\n=== logout encerra o grant, venha por qual token vier (RFC 7009) ===');

  const newSwap = async () => {
    const v = crypto.randomBytes(32).toString('base64url');
    const c = crypto.createHash('sha256').update(v, 'ascii').digest('base64url');
    const q = new URLSearchParams({
      client_id: clientId, redirect_uri: REDIRECT, response_type: 'code',
      code_challenge: c, code_challenge_method: 'S256', state: crypto.randomBytes(8).toString('base64url'),
    });
    const r = await api('GET', `/oauth/authorize?${q}`, null, { cookie: sessionCookie });
    const authCode = new URL(r.location).searchParams.get('code');
    return tokenReq({
      grant_type: 'authorization_code', code: authCode, code_verifier: v, redirect_uri: REDIRECT,
      client_assertion_type: 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer',
      client_assertion: clientAssertion(clientId, privateKey),
    });
  };

  const alive = async () =>
    (await db.query(
      `SELECT count(*)::int AS n FROM "RefreshToken"
        WHERE "authSessionId" = $1 AND "projectId" = $2 AND "revokedAt" IS NULL`,
      [sessionId, projectId],
    )).rows[0].n;

  const pairA = await newSwap();
  const claimsA = JSON.parse(
    Buffer.from(pairA.json.access_token.split('.')[1], 'base64url').toString(),
  );

  check('o access token carrega sid, a ancora de revogacao (RFC 9068 secao 2.2.1)',
    claimsA.sid === sessionId, claimsA.sid ?? 'ausente');

  check('havia refresh token vivo antes de revogar', (await alive()) > 0);

  const revokesByAccess = await fetch(`${BASE}/oauth/revoke`, form({
    token: pairA.json.access_token,
    token_type_hint: 'access_token',
    client_assertion_type: 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer',
    client_assertion: clientAssertion(clientId, privateKey),
  }));
  check('revoke aceitando ACCESS token responde 200', revokesByAccess.ok, `HTTP ${revokesByAccess.status}`);
  check('e derruba a familia de refresh tokens do mesmo grant',
    (await alive()) === 0, `${await alive()} vivo(s)`);

  const renewLater = await tokenReq({
    grant_type: 'refresh_token', refresh_token: pairA.json.refresh_token,
    client_assertion_type: 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer',
    client_assertion: clientAssertion(clientId, privateKey),
  });
  check('depois disso o refresh token nao renova mais',
    renewLater.status === 400 && renewLater.json?.error === 'invalid_grant',
    `HTTP ${renewLater.status} ${renewLater.json?.error ?? ''}`);

  const pairB = await newSwap();
  const otherProject = await api('POST', '/project', { name: `intruso-${tag}` });
  run.projects.push(otherProject.json?.id);
  const intruderKey = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  await api('POST', '/clientkey', { projectId: otherProject.json.id, publicKeyPem: intruderKey.publicKey });
  await api('PATCH', `/project/${otherProject.json.id}/status`, { status: 'ACTIVE' });

  const attempt = await fetch(`${BASE}/oauth/revoke`, form({
    token: pairB.json.access_token,
    token_type_hint: 'access_token',
    client_assertion_type: 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer',
    client_assertion: clientAssertion(otherProject.json.clientId, intruderKey.privateKey),
  }));
  check('outro cliente apresentando o token capturado recebe 200 mas nao revoga nada',
    attempt.ok && (await alive()) > 0, `HTTP ${attempt.status}, ${await alive()} vivo(s)`);

  console.log('\n=== autorizacao administrativa vem do banco ===');

  const adminReq = async (method, routePath, headers, body) => {
    const res = await fetch(`${BASE}${routePath}`, {
      method,
      headers: { 'content-type': 'application/json', ...headers },
      body: body ? JSON.stringify(body) : undefined,
      redirect: 'manual',
    });
    return {
      status: res.status,
      wwwAuth: res.headers.get('www-authenticate'),
      json: await res.json().catch(() => null),
    };
  };

  const noCredential = await adminReq('GET', '/project', {});
  check('rota administrativa sem Bearer devolve 401',
    noCredential.status === 401, `HTTP ${noCredential.status}`);
  check('401 administrativo traz WWW-Authenticate (RFC 6750 secao 3)',
    !!noCredential.wwwAuth, noCredential.wwwAuth ?? 'ausente');

  const oldSecret = await adminReq('GET', '/project', {
    'x-sso-secret': env.SSO_ADMIN_SECRET ?? 'segredo-que-nao-existe-mais',
  });
  check('x-sso-secret nao abre mais nada',
    oldSecret.status === 401, `HTTP ${oldSecret.status}`);

  const otherProjectToken = await adminReq('GET', '/project', {
    authorization: `Bearer ${ok.json.access_token}`,
  });
  check('token de outra aplicacao nao vira credencial administrativa',
    otherProjectToken.status === 401, `HTTP ${otherProjectToken.status}`);

  const superHeaders = { authorization: `Bearer ${superadmin.token}` };

  const me = await adminReq('GET', '/me', superHeaders);
  check('GET /me devolve o papel lido do banco',
    me.status === 200 && me.json?.role === 'SUPERADMIN', `HTTP ${me.status} ${me.json?.role ?? ''}`);
  check('GET /me marca a raiz, que nao depende do catalogo', me.json?.root === true, String(me.json?.root));

  const rootRoutes = new Set((me.json?.permissions ?? []).map((p) => `${p.method} ${p.path}`));
  const outsideRbac = (entry) => entry === 'GET /me' || / \/(oauth|session|login|\.well-known|health)\b/.test(entry);
  check('para a raiz, GET /me lista toda rota administrativa do servidor, cadastrada ou nao',
    ['GET /project', 'POST /role', 'PUT /projectuser/:projectId/:userId', 'DELETE /projectuser/:projectId/:userId',
      'POST /clientkey/generate'].every((entry) => rootRoutes.has(entry)),
    `${rootRoutes.size} rota(s)`);
  check('rota publica ou so autenticada fica fora da lista da raiz',
    rootRoutes.size > 0 && ![...rootRoutes].some(outsideRbac),
    [...rootRoutes].filter(outsideRbac).join(', ') || 'nenhuma');

  console.log('\n=== papeis do SSO criados pela raiz, rota a rota ===');

  const ssoId = (await db.query(`SELECT id FROM "Project" WHERE name = 'SSO'`)).rows[0].id;

  const ssoRoute = async (method, routePath) => {
    const existing = (await db.query(
      'SELECT id FROM "Route" WHERE "projectId" = $1 AND path = $2 AND method = $3::"Method"',
      [ssoId, routePath, method],
    )).rows[0];

    if (existing) return existing.id;

    const created = await api('POST', '/route', { projectId: ssoId, path: routePath, method });

    if (created.status !== 201) throw new Error(`a raiz nao cadastrou ${method} ${routePath}: HTTP ${created.status}`);

    run.ssoRoutes.push(created.json.id);
    return created.json.id;
  };

  const ssoRole = async (roleName, routes) => {
    const created = await api('POST', '/role', { projectId: ssoId, name: roleName });

    if (created.status !== 201) throw new Error(`a raiz nao criou o papel ${roleName}: HTTP ${created.status}`);

    run.ssoRoles.push(created.json.id);

    for (const [method, routePath] of routes) {
      const granted = await api('POST', '/permission', {
        roleId: created.json.id, routeId: await ssoRoute(method, routePath),
      });

      if (granted.status !== 201) throw new Error(`a raiz nao concedeu ${method} ${routePath}: HTTP ${granted.status}`);
    }

    return created.json;
  };

  const ROLE_READER = `E2E_LEITOR_${TAG}`;
  const ROLE_MANAGER = `E2E_GESTOR_${TAG}`;

  const reader = await ssoRole(ROLE_READER, [['GET', '/project']]);
  const manager = await ssoRole(ROLE_MANAGER, [
    ['GET', '/project'],
    ['POST', '/role'], ['PUT', '/role/:id'], ['DELETE', '/role/:id'],
    ['POST', '/route'], ['PUT', '/route/:id'], ['DELETE', '/route/:id'],
    ['POST', '/permission'], ['DELETE', '/permission/:id'],
    ['POST', '/projectuser'], ['PUT', '/projectuser/:projectId/:userId'], ['DELETE', '/projectuser/:projectId/:userId'],
    ['PUT', '/redirecturi/:id'], ['DELETE', '/redirecturi/:id'],
  ]);
  check('a raiz cria no SSO papeis com nome livre e marca as rotas de cada um', !!reader.id && !!manager.id);

  await ensureOperator(db, { email: READER, name: 'E2E Leitor', role: ROLE_READER });
  await ensureOperator(db, { email: MANAGER, name: 'E2E Gestor', role: ROLE_MANAGER });

  const readerToken = await mintOperatorToken(db, { issuer: BASE, cookieSecret: env.COOKIE_SECRET, email: READER });
  const managerToken = await mintOperatorToken(db, { issuer: BASE, cookieSecret: env.COOKIE_SECRET, email: MANAGER });
  const readerHeaders = { authorization: `Bearer ${readerToken.token}` };
  const managerHeaders = { authorization: `Bearer ${managerToken.token}` };

  const readerReads = await adminReq('GET', '/project', readerHeaders);
  check('papel com GET /project le o catalogo', readerReads.status === 200, `HTTP ${readerReads.status}`);

  const readerMe = await adminReq('GET', '/me', readerHeaders);
  check('GET /me lista as permissoes de quem nao e raiz',
    readerMe.json?.root === false && readerMe.json?.permissions?.length === 1,
    `${readerMe.json?.permissions?.length ?? 0} rota(s)`);

  console.log('\n=== sem permissao, 404 como caminho inexistente (RFC 9110 secao 15.5.4) ===');

  const readerWrites = await adminReq('POST', '/project', readerHeaders, { name: `proibido-${tag}` });
  const missingPath = await adminReq('POST', `/nao-existe-${tag}`, readerHeaders, { name: 'x' });
  check('papel sem POST /project recebe 404', readerWrites.status === 404, `HTTP ${readerWrites.status}`);
  check('o 404 da rota negada e igual ao de um caminho que nao existe',
    readerWrites.json?.message === 'Cannot POST /sso/project'
      && missingPath.status === 404
      && missingPath.json?.message === `Cannot POST /sso/nao-existe-${tag}`
      && readerWrites.json?.error === missingPath.json?.error,
    `${readerWrites.json?.message} | ${missingPath.json?.message}`);
  check('o 404 da rota negada nao anuncia como se autentica',
    !readerWrites.wwwAuth && !missingPath.wwwAuth, readerWrites.wwwAuth ?? 'sem WWW-Authenticate');

  const managerGeneratesKey = await adminReq('POST', '/clientkey/generate', managerHeaders, { projectId });
  check('papel sem permissao de gerar chave recebe 404', managerGeneratesKey.status === 404, `HTTP ${managerGeneratesKey.status}`);

  const superGeneratesKey = await adminReq('POST', '/clientkey/generate', superHeaders, { projectId });
  check('a raiz gera a chave privada',
    superGeneratesKey.status === 201 && !!superGeneratesKey.json?.privateKeyBase64,
    `HTTP ${superGeneratesKey.status}`);
  check('a chave privada nao fica gravada, so volta na resposta',
    superGeneratesKey.json?.privateKeyBase64?.length > 0 && !superGeneratesKey.json?.id?.includes('.'),
    `id ${superGeneratesKey.json?.id ?? 'ausente'}`);

  await db.query(
    'DELETE FROM "ProjectUser" WHERE "userId" = $1 AND "projectId" = $2',
    [readerToken.userId, ssoId],
  );
  const afterUnlink = await adminReq('GET', '/project', readerHeaders);
  check('tirar o vinculo derruba o acesso sem esperar o token expirar',
    afterUnlink.status === 404, `HTTP ${afterUnlink.status}`);
  await ensureOperator(db, { email: READER, name: 'E2E Leitor', role: ROLE_READER });

  console.log('\n=== papeis customizados nas aplicacoes ===');

  const architect = await adminReq('POST', '/role', managerHeaders, { projectId, name: 'ARQUITETO' });
  check('gestor cria o papel ARQUITETO numa aplicacao', architect.status === 201, `HTTP ${architect.status}`);

  const nonStandardName = await adminReq('POST', '/role', managerHeaders, { projectId, name: 'arquiteto' });
  check('nome de papel fora do padrao e recusado (400)', nonStandardName.status === 400, `HTTP ${nonStandardName.status}`);

  const duplicateRole = await adminReq('POST', '/role', managerHeaders, { projectId, name: 'ARQUITETO' });
  check('nome de papel repetido no mesmo projeto e recusado (409)', duplicateRole.status === 409, `HTTP ${duplicateRole.status}`);

  const grantsArchitect = await adminReq('POST', '/permission', managerHeaders, {
    roleId: architect.json?.id, routeId: route.json.id,
  });
  check('gestor marca a rota que o ARQUITETO alcanca', grantsArchitect.status === 201, `HTTP ${grantsArchitect.status}`);

  const architectSet = await fetch(`${BASE}/oauth/permissions`, form({
    role: 'ARQUITETO',
    client_assertion_type: 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer',
    client_assertion: clientAssertion(clientId, privateKey),
  }));
  const architectPermissions = architectSet.ok ? await architectSet.json() : null;
  check('a aplicacao resolve as rotas do papel customizado',
    JSON.stringify(architectPermissions?.permissions) === JSON.stringify([{ path: '/equipment', method: 'GET' }]),
    JSON.stringify(architectPermissions?.permissions));

  console.log('\n=== trocar o papel de alguem e tirar alguem do projeto ===');

  run.users.push(`colega-${tag}@exemplo.com`);
  const peer = await api('POST', '/user', { name: 'Colega', email: `colega-${tag}@exemplo.com` });
  const linksPeer = await adminReq('POST', '/projectuser', managerHeaders, {
    userId: peer.json.id, projectId, roleId: roleAdmin.id,
  });
  check('gestor vincula uma pessoa a uma aplicacao', linksPeer.status === 201, `HTTP ${linksPeer.status}`);

  const roleSwap = await adminReq('PUT', `/projectuser/${projectId}/${peer.json.id}`, managerHeaders, {
    roleId: architect.json?.id,
  });
  check('gestor troca o papel da pessoa, e o novo substitui o anterior',
    roleSwap.status === 200 && roleSwap.json?.roleId === architect.json?.id, `HTTP ${roleSwap.status}`);

  const otherProjectRole = await adminReq('PUT', `/projectuser/${projectId}/${peer.json.id}`, managerHeaders, {
    roleId: reader.id,
  });
  check('papel de outro projeto nao serve para a troca (400)', otherProjectRole.status === 400, `HTTP ${otherProjectRole.status}`);

  await db.query(
    `INSERT INTO "RefreshToken" (id, "tokenHash", "familyId", "userId", "projectId", "authSessionId", "expiresAt")
     VALUES ($1, $2, $3, $4, $5, $6, (now() AT TIME ZONE 'utc') + interval '1 hour')`,
    [crypto.randomUUID(), crypto.randomBytes(32).toString('hex'), crypto.randomUUID(), peer.json.id, projectId, sessionId],
  );

  const removesPeer = await adminReq('DELETE', `/projectuser/${projectId}/${peer.json.id}`, managerHeaders);
  const refreshPeer = (await db.query(
    'SELECT count(*)::int AS n FROM "RefreshToken" WHERE "userId" = $1 AND "projectId" = $2 AND "revokedAt" IS NULL',
    [peer.json.id, projectId],
  )).rows[0].n;
  check('gestor tira a pessoa do projeto (204)', removesPeer.status === 204, `HTTP ${removesPeer.status}`);
  check('tirar do projeto revoga os refresh tokens da pessoa ali', refreshPeer === 0, `${refreshPeer} vivo(s)`);

  const removeAgain = await adminReq('DELETE', `/projectuser/${projectId}/${peer.json.id}`, managerHeaders);
  check('tirar quem ja saiu devolve 404', removeAgain.status === 404, `HTTP ${removeAgain.status}`);

  console.log('\n=== apagar quem nao tem mais projeto ===');

  run.users.push(`ocioso-${tag}@exemplo.com`);
  const idle = await api('POST', '/user', { name: 'Ocioso', email: `ocioso-${tag}@exemplo.com` });
  const idleSession = crypto.randomUUID();
  await db.query(
    `INSERT INTO "AuthSession" (id, "userId", "expiresAt")
     VALUES ($1, $2, (now() AT TIME ZONE 'utc') + interval '1 hour')`,
    [idleSession, idle.json.id],
  );
  const idleRefresh = crypto.randomBytes(32).toString('base64url');
  await db.query(
    `INSERT INTO "RefreshToken" (id, "tokenHash", "familyId", "userId", "projectId", "authSessionId", "expiresAt")
     VALUES ($1, $2, $3, $4, $5, $6, (now() AT TIME ZONE 'utc') + interval '1 hour')`,
    [crypto.randomUUID(), crypto.createHash('sha256').update(idleRefresh).digest('hex'),
      crypto.randomUUID(), idle.json.id, projectId, idleSession],
  );
  await db.query(
    `INSERT INTO "AuthorizationCode"
       (id, "codeHash", "userId", "projectId", "authSessionId", "redirectUri", "codeChallenge", "expiresAt")
     VALUES ($1, $2, $3, $4, $5, $6, $7, (now() AT TIME ZONE 'utc') + interval '5 minutes')`,
    [crypto.randomUUID(), crypto.randomBytes(32).toString('hex'), idle.json.id, projectId,
      idleSession, REDIRECT, challenge],
  );

  await api('POST', '/projectuser', { userId: idle.json.id, projectId, roleId: roleAdmin.id });
  const deletesWithProject = await api('DELETE', `/user/${idle.json.id}`);
  const sessionsAfterRefusal = (await db.query(
    'SELECT count(*)::int AS n FROM "AuthSession" WHERE "userId" = $1', [idle.json.id],
  )).rows[0].n;
  check('quem ainda tem projeto nao se apaga (400), e nada dela e tocado',
    deletesWithProject.status === 400 && sessionsAfterRefusal === 1,
    `HTTP ${deletesWithProject.status}, ${sessionsAfterRefusal} sessao(oes)`);

  await api('DELETE', `/projectuser/${projectId}/${idle.json.id}`);
  const deleted = await api('DELETE', `/user/${idle.json.id}`);
  check('sem projeto, apagar passa mesmo com sessao, code e refresh token (204)',
    deleted.status === 204, `HTTP ${deleted.status}`);

  const leftovers = (await db.query(
    `SELECT
       (SELECT count(*)::int FROM "User" WHERE id = $1) AS usuario,
       (SELECT count(*)::int FROM "AuthSession" WHERE "userId" = $1) AS sessoes,
       (SELECT count(*)::int FROM "RefreshToken" WHERE "userId" = $1 OR "authSessionId" = $2) AS refresh,
       (SELECT count(*)::int FROM "AuthorizationCode" WHERE "userId" = $1 OR "authSessionId" = $2) AS codes`,
    [idle.json.id, idleSession],
  )).rows[0];
  check('a exclusao leva junto a sessao, os refresh tokens e os codes da pessoa',
    Object.values(leftovers).every((n) => n === 0), JSON.stringify(leftovers));

  const deletedRefresh = await tokenReq({
    grant_type: 'refresh_token', refresh_token: idleRefresh,
    client_assertion_type: 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer',
    client_assertion: clientAssertion(clientId, privateKey),
  });
  check('o refresh token de quem foi apagado nao renova mais',
    deletedRefresh.status === 400 && deletedRefresh.json?.error === 'invalid_grant',
    `HTTP ${deletedRefresh.status} ${deletedRefresh.json?.error ?? ''}`);

  const deletedUserSession = await api('GET', authorizeQs(), null, {
    cookie: `sso_session=${sealCookie({ authSessionId: idleSession })}`,
  });
  check('a sessao dela no SSO morre junto: o authorize volta a tela de login',
    deletedUserSession.status === 302 && deletedUserSession.location === env.SSO_LOGIN_URL,
    deletedUserSession.location ?? `HTTP ${deletedUserSession.status}`);

  const deleteUserAgain = await api('DELETE', `/user/${idle.json.id}`);
  check('apagar quem ja saiu do banco devolve 404', deleteUserAgain.status === 404,
    `HTTP ${deleteUserAgain.status}`);

  console.log('\n=== gestao: o overview traz os ids que editar exige ===');

  const overview = await api('GET', `/project/${projectId}/overview`);
  const seenPermission = overview.json?.roles?.find((r) => r.name === 'ADMIN')?.permissions?.[0];
  check('overview traz o id de cada redirect URI',
    !!overview.json?.redirectUriRecords?.[0]?.id, JSON.stringify(overview.json?.redirectUriRecords ?? null));
  check('overview traz id e routeId de cada permissao, para DELETE /permission/:id',
    !!seenPermission?.id && seenPermission?.routeId === route.json.id, JSON.stringify(seenPermission ?? null));

  const uriWithExtraField = await api('POST', '/redirecturi', {
    projectId, redirectUri: 'http://localhost:3999/cb', unexpected: true,
  });
  check('POST /redirecturi valida o corpo pelo DTO e recusa campo a mais',
    uriWithExtraField.status === 400, `HTTP ${uriWithExtraField.status}`);

  console.log('\n=== gestao: apagar redirect URI ===');

  const EXTRA = 'http://localhost:3999/api/auth/callback';
  const extra = await api('POST', '/redirecturi', { projectId, redirectUri: EXTRA });
  check('um segundo endereco entra no projeto', extra.status === 201, `HTTP ${extra.status}`);

  const verifierExtra = crypto.randomBytes(32).toString('base64url');
  const allowsExtra = await api('GET', `/oauth/authorize?${new URLSearchParams({
    client_id: clientId, redirect_uri: EXTRA, response_type: 'code', code_challenge_method: 'S256',
    code_challenge: crypto.createHash('sha256').update(verifierExtra, 'ascii').digest('base64url'),
    state: crypto.randomBytes(16).toString('base64url'),
  })}`, null, { cookie: sessionCookie });
  const codeExtra = allowsExtra.location ? new URL(allowsExtra.location).searchParams.get('code') : null;
  check('com sessao viva o SSO emite code para o segundo endereco', !!codeExtra, `HTTP ${allowsExtra.status}`);

  const readerDeletes = await adminReq('DELETE', `/redirecturi/${extra.json?.id}`, readerHeaders);
  check('papel sem DELETE /redirecturi/:id recebe 404', readerDeletes.status === 404, `HTTP ${readerDeletes.status}`);

  const deletedUri = await adminReq('DELETE', `/redirecturi/${extra.json?.id}`, managerHeaders);
  check('gestor apaga redirect URI de uma aplicacao (204)', deletedUri.status === 204, `HTTP ${deletedUri.status}`);

  const deleteAgain = await adminReq('DELETE', `/redirecturi/${extra.json?.id}`, managerHeaders);
  check('apagar o que ja saiu devolve 404', deleteAgain.status === 404, `HTTP ${deleteAgain.status}`);

  const addresses = (await api('GET', `/project/${projectId}/overview`)).json?.redirectUriRecords
    ?.map((r) => r.redirectUri) ?? [];
  check('o overview perde so o endereco apagado',
    !addresses.includes(EXTRA) && addresses.includes(REDIRECT), JSON.stringify(addresses));

  const authorizeOfDeleted = await api('GET', `/oauth/authorize?${new URLSearchParams({
    client_id: clientId, redirect_uri: EXTRA,
  })}`, null, {});
  check('authorize com o endereco apagado NAO redireciona',
    authorizeOfDeleted.status === 400 && !authorizeOfDeleted.location, `HTTP ${authorizeOfDeleted.status}`);

  const swapAfterDelete = await tokenReq({
    grant_type: 'authorization_code', code: codeExtra, code_verifier: verifierExtra, redirect_uri: EXTRA,
    client_assertion_type: 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer',
    client_assertion: clientAssertion(clientId, privateKey),
  });
  check('code emitido antes de apagar o endereco nao vira token',
    swapAfterDelete.status === 400 && swapAfterDelete.json?.error === 'invalid_grant',
    `HTTP ${swapAfterDelete.status} ${swapAfterDelete.json?.error_description ?? ''}`);

  console.log('\n=== gestao: apagar projeto ===');

  const disposable = await api('POST', '/project', { name: `descartavel-${tag}` });
  run.projects.push(disposable.json?.id);
  await api('POST', '/redirecturi', { projectId: disposable.json?.id, redirectUri: 'http://localhost:3998/api/auth/callback' });
  await api('POST', '/clientkey/generate', { projectId: disposable.json?.id });
  const disposableRoute = await api('POST', '/route', { projectId: disposable.json?.id, path: '/rascunho', method: 'GET' });

  const deleteWithRoute = await api('DELETE', `/project/${disposable.json?.id}`);
  check('projeto com rota nao se apaga (400)', deleteWithRoute.status === 400, `HTTP ${deleteWithRoute.status}`);

  await api('DELETE', `/route/${disposableRoute.json?.id}`);
  const deleteProject = await api('DELETE', `/project/${disposable.json?.id}`);
  const afterDelete = await api('GET', `/project/${disposable.json?.id}/overview`);
  check('projeto sem rotas nem membros se apaga com papeis padrao, redirect URI e chave (204)',
    deleteProject.status === 204 && afterDelete.status === 404,
    `HTTP ${deleteProject.status}, overview ${afterDelete.status}`);

  console.log('\n=== o projeto do proprio SSO: so a raiz mexe, e nem ela desmonta ===');

  const isProtected = (r) => r.status === 403 && r.json?.error === 'sso_project_protected';
  const detailOf = (r) => `HTTP ${r.status} ${r.json?.error ?? ''}`;

  const deleteSso = await api('DELETE', `/project/${ssoId}`);
  check('nem a raiz apaga o projeto SSO', isProtected(deleteSso), detailOf(deleteSso));

  const renameSso = await api('PUT', `/project/${ssoId}`, { name: 'SSO' });
  check('nem a raiz renomeia o projeto SSO', isProtected(renameSso), detailOf(renameSso));

  const suspendSso = await api('PATCH', `/project/${ssoId}/status`, { status: 'SUSPENDED' });
  if (suspendSso.status < 300) {
    await db.query(`UPDATE "Project" SET status = 'ACTIVE', "suspendedAt" = NULL WHERE id = $1`, [ssoId]);
  }
  check('nem a raiz tira o projeto SSO de ACTIVE', isProtected(suspendSso), detailOf(suspendSso));

  const ssoRoot = (await db.query(
    `SELECT id FROM "Role" WHERE "projectId" = $1 AND name = 'SUPERADMIN'`, [ssoId])).rows[0];

  const renameRoot = await api('PUT', `/role/${ssoRoot.id}`, { name: `SUPERADMIN_${TAG}` });
  if (renameRoot.status < 300) {
    await db.query(`UPDATE "Role" SET name = 'SUPERADMIN' WHERE id = $1`, [ssoRoot.id]);
  }
  check('o papel SUPERADMIN do SSO nao se renomeia', isProtected(renameRoot), detailOf(renameRoot));

  const deleteRoot = await api('DELETE', `/role/${ssoRoot.id}`);
  check('o papel SUPERADMIN do SSO nao se apaga', isProtected(deleteRoot), detailOf(deleteRoot));

  run.ssoRoleNames.push(`E2E_TEMPORARIO_${TAG}`, `E2E_TENTATIVA_${TAG}`);
  const temporarySsoRole = await api('POST', '/role', { projectId: ssoId, name: `E2E_TEMPORARIO_${TAG}` });
  const deletesTemporaryInSso = await api('DELETE', `/role/${temporarySsoRole.json?.id}`);
  check('a raiz cria e apaga papel de gestao no SSO',
    temporarySsoRole.status === 201 && deletesTemporaryInSso.status === 204,
    `${detailOf(temporarySsoRole)} / ${detailOf(deletesTemporaryInSso)}`);

  const ATTEMPT_PATH = `/e2e-tentativa-${tag}`;
  run.ssoRoutePaths.push(ATTEMPT_PATH);
  const managerCreatesRoute = await adminReq('POST', '/route', managerHeaders, { projectId: ssoId, path: ATTEMPT_PATH, method: 'GET' });
  check('papel de gestao nao cria rota no SSO', isProtected(managerCreatesRoute), detailOf(managerCreatesRoute));

  const readRoute = await ssoRoute('GET', '/project');
  const managerEditsRoute = await adminReq('PUT', `/route/${readRoute}`, managerHeaders, { path: '/project' });
  check('papel de gestao nao edita rota do SSO', isProtected(managerEditsRoute), detailOf(managerEditsRoute));

  const managerDeletesRoute = await adminReq('DELETE', `/route/${readRoute}`, managerHeaders);
  check('papel de gestao nao apaga rota do SSO', isProtected(managerDeletesRoute), detailOf(managerDeletesRoute));

  const managerCreatesRole = await adminReq('POST', '/role', managerHeaders, { projectId: ssoId, name: `E2E_TENTATIVA_${TAG}` });
  check('papel de gestao nao cria papel no SSO', isProtected(managerCreatesRole), detailOf(managerCreatesRole));

  const managerEditsRole = await adminReq('PUT', `/role/${reader.id}`, managerHeaders, { name: ROLE_READER });
  check('papel de gestao nao edita papel do SSO', isProtected(managerEditsRole), detailOf(managerEditsRole));

  const managerDeletesRole = await adminReq('DELETE', `/role/${reader.id}`, managerHeaders);
  check('papel de gestao nao apaga papel do SSO', isProtected(managerDeletesRole), detailOf(managerDeletesRole));

  const managerGrants = await adminReq('POST', '/permission', managerHeaders, {
    roleId: reader.id, routeId: await ssoRoute('POST', '/role'),
  });
  check('papel de gestao nao concede permissao no SSO', isProtected(managerGrants), detailOf(managerGrants));

  const readerPermission = (await db.query(
    'SELECT id FROM "Permission" WHERE "roleId" = $1 LIMIT 1', [reader.id])).rows[0];
  const managerRevokes = await adminReq('DELETE', `/permission/${readerPermission.id}`, managerHeaders);
  check('papel de gestao nao revoga permissao no SSO', isProtected(managerRevokes), detailOf(managerRevokes));

  const escalation = await adminReq('POST', '/projectuser', managerHeaders, {
    userId: peer.json.id, projectId: ssoId, roleId: ssoRoot.id,
  });
  if (escalation.status < 300) {
    await db.query('DELETE FROM "ProjectUser" WHERE "userId" = $1 AND "projectId" = $2', [peer.json.id, ssoId]);
  }
  check('papel de gestao nao coloca ninguem como SUPERADMIN (escalada de privilegio)', isProtected(escalation), detailOf(escalation));

  const rootLinks = await api('POST', '/projectuser', { userId: peer.json.id, projectId: ssoId, roleId: reader.id });
  const rootUnlinks = await api('DELETE', `/projectuser/${ssoId}/${peer.json.id}`);
  check('a raiz vincula e desvincula pessoas no SSO',
    rootLinks.status === 201 && rootUnlinks.status === 204,
    `${detailOf(rootLinks)} / ${detailOf(rootUnlinks)}`);

  const ssoUris = async () => (await db.query(
    'SELECT id, "redirectUri" FROM "redirectUri" WHERE "projectId" = $1 ORDER BY "redirectUri"', [ssoId])).rows;
  const [firstSsoUri] = await ssoUris();

  const editSsoUri = await api('PUT', `/redirecturi/${firstSsoUri.id}`, { redirectUri: firstSsoUri.redirectUri });
  check('redirect URI do SSO nao se edita, nem pela raiz', isProtected(editSsoUri), detailOf(editSsoUri));

  const TEMPORARY_ORIGIN = `http://localhost:${59000 + crypto.randomInt(900)}`;
  const temporaryUri = await api('POST', '/redirecturi', { projectId: ssoId, redirectUri: `${TEMPORARY_ORIGIN}/callback` });
  run.ssoUris.push(temporaryUri.json?.id);
  check('a raiz cadastra redirect URI nova no SSO', temporaryUri.status === 201, `HTTP ${temporaryUri.status}`);

  const managerDeletesUri = await adminReq('DELETE', `/redirecturi/${temporaryUri.json?.id}`, managerHeaders);
  check('papel de gestao nao apaga redirect URI do SSO', isProtected(managerDeletesUri), detailOf(managerDeletesUri));

  const deleteOwn = await adminReq('DELETE', `/redirecturi/${temporaryUri.json?.id}`,
    { ...superHeaders, origin: TEMPORARY_ORIGIN });
  check('ninguem apaga a redirect URI do SSO da origem de onde pede',
    deleteOwn.status === 403 && deleteOwn.json?.error === 'sso_redirect_uri_in_use', detailOf(deleteOwn));

  const temporaryDelete = await adminReq('DELETE', `/redirecturi/${temporaryUri.json?.id}`, superHeaders);
  check('a raiz apaga redirect URI do SSO que nao e a ultima nem a de quem pede (204)',
    temporaryDelete.status === 204, detailOf(temporaryDelete));

  const remaining = await ssoUris();
  if (remaining.length === 1) {
    const [onlyUri] = remaining;
    const lastDelete = await api('DELETE', `/redirecturi/${onlyUri.id}`);
    if (lastDelete.status < 300) {
      await db.query('INSERT INTO "redirectUri" (id, "projectId", "redirectUri") VALUES ($1, $2, $3)',
        [onlyUri.id, ssoId, onlyUri.redirectUri]);
    }
    check('a ultima redirect URI do SSO nao sai',
      lastDelete.status === 403 && lastDelete.json?.error === 'sso_redirect_uri_last', detailOf(lastDelete));
  } else {
    console.log(`  --    | ultima redirect URI do SSO: nao testado, o projeto tem ${remaining.length}`);
  }

  if (temporaryUri.json?.id) {
    await db.query('DELETE FROM "redirectUri" WHERE id = $1', [temporaryUri.json.id]);
  }
  await db.query('DELETE FROM "Route" WHERE "projectId" = $1 AND path = $2', [ssoId, ATTEMPT_PATH]);
  await db.query('DELETE FROM "Role" WHERE "projectId" = $1 AND name = ANY($2)',
    [ssoId, [`E2E_TENTATIVA_${TAG}`, `E2E_TEMPORARIO_${TAG}`]]);

  console.log('\n=== tela de login do IdP: so abre com pedido pendente ===');

  const LOGIN_URL = env.SSO_LOGIN_URL;
  check('SSO_LOGIN_URL configurada', !!LOGIN_URL, LOGIN_URL ?? 'ausente em sso/.env.docker');

  const rawReq = async (method, routePath, headers = {}, body) => {
    const res = await fetch(`${BASE}${routePath}`, {
      method,
      headers: body ? { 'content-type': 'application/json', ...headers } : headers,
      body: body ? JSON.stringify(body) : undefined,
      redirect: 'manual',
    });
    return {
      status: res.status,
      location: res.headers.get('location'),
      cookies: res.headers.getSetCookie(),
      json: await res.json().catch(() => null),
    };
  };

  const cookieOf = (setCookies, base) => {
    const line = setCookies.find((c) => c.startsWith(`${base}=`) || c.startsWith(`__Host-${base}=`));
    return line ? line.split(';')[0] : null;
  };

  const noSession = await rawReq('GET', authorizeQs());
  check('authorize sem sessao leva a tela de login do front, nao direto ao Google',
    noSession.status === 302 && noSession.location === LOGIN_URL,
    noSession.location ?? `HTTP ${noSession.status}`);

  const txCookie = cookieOf(noSession.cookies, 'sso_tx');
  check('o pedido pendente fica no cookie de transacao', !!txCookie);

  const request = await rawReq('GET', '/login/request', { cookie: txCookie });
  check('a tela de login le o pedido: qual aplicacao pediu',
    request.status === 200 && request.json?.kind === 'authorize' && request.json?.application === `krloc-${tag}`,
    `HTTP ${request.status} ${JSON.stringify(request.json)}`);
  check('o provedor Google aponta para o inicio da federacao no SSO',
    request.json?.providers?.[0]?.url === `${BASE}/oauth/google`,
    request.json?.providers?.[0]?.url ?? 'ausente');

  const noRequest = await rawReq('GET', '/login/request');
  check('sem pedido pendente a tela de login nao oferece login (404)',
    noRequest.status === 404 && noRequest.json?.error === 'no_pending_request', `HTTP ${noRequest.status}`);

  const googleNoRequest = await rawReq('GET', '/oauth/google');
  check('ir direto ao Google sem pedido volta a tela de login com o motivo',
    googleNoRequest.status === 302 && googleNoRequest.location === `${LOGIN_URL}?error=no_pending_request`,
    googleNoRequest.location ?? `HTTP ${googleNoRequest.status}`);

  const googleWithRequest = await rawReq('GET', '/oauth/google', { cookie: txCookie });
  const googleHop = googleWithRequest.location ? new URL(googleWithRequest.location) : null;
  check('com pedido pendente segue ao Google, com o nonce como state',
    googleWithRequest.status === 302 && googleHop?.hostname === 'accounts.google.com'
      && (googleHop?.searchParams.get('state') ?? '').length > 0,
    googleHop ? `${googleHop.hostname}${googleHop.pathname}` : `HTTP ${googleWithRequest.status}`);

  const callbackNoRequest = await rawReq('GET', '/oauth/google/callback?code=x&state=y');
  check('callback do Google sem pedido volta a tela de login como expirado',
    callbackNoRequest.status === 302 && callbackNoRequest.location === `${LOGIN_URL}?error=request_expired`,
    callbackNoRequest.location ?? `HTTP ${callbackNoRequest.status}`);

  console.log('\n=== console do SSO: entra como aplicacao, usa a sessao (RFC 10017 secao 7.1) ===');

  const consoleRedirect = (await db.query(
    `SELECT r."redirectUri" AS uri FROM "redirectUri" r
       JOIN "Project" p ON p.id = r."projectId"
      WHERE p.name = 'SSO' ORDER BY r."redirectUri" LIMIT 1`,
  )).rows[0]?.uri;
  check('o projeto SSO tem redirect_uri para o console', !!consoleRedirect, consoleRedirect ?? 'ausente');

  const consoleState = crypto.randomBytes(18).toString('base64url');
  const sessionLoginQs = (extra = {}) =>
    `/session/login?${new URLSearchParams({ redirect_uri: consoleRedirect, state: consoleState, ...extra })}`;

  const strangeRedirect = await rawReq('GET', sessionLoginQs({ redirect_uri: 'http://evil.example/callback' }));
  check('login do console com redirect_uri nao registrada NAO redireciona',
    strangeRedirect.status === 400 && !strangeRedirect.location && strangeRedirect.json?.error === 'invalid_request',
    `HTTP ${strangeRedirect.status}`);

  const weakState = await rawReq('GET', sessionLoginQs({ state: 'curto' }));
  check('state fraco volta como erro pela redirect_uri do console',
    weakState.status === 302 && weakState.location?.startsWith(consoleRedirect)
      && new URL(weakState.location).searchParams.get('error') === 'invalid_request',
    weakState.location ?? `HTTP ${weakState.status}`);

  const consoleNoSession = await rawReq('GET', sessionLoginQs());
  check('o console sem sessao tambem passa pela tela de login',
    consoleNoSession.status === 302 && consoleNoSession.location === LOGIN_URL,
    consoleNoSession.location ?? `HTTP ${consoleNoSession.status}`);

  const consoleRequest = await rawReq('GET', '/login/request', {
    cookie: cookieOf(consoleNoSession.cookies, 'sso_tx'),
  });
  check('a tela de login sabe que o pedido e do console',
    consoleRequest.json?.kind === 'session' && consoleRequest.json?.application === 'SSO',
    JSON.stringify(consoleRequest.json));

  const operatorId = (await db.query('SELECT id FROM "User" WHERE email = $1', [OPERATOR])).rows[0].id;
  const operatorSession = crypto.randomUUID();
  await db.query(
    `INSERT INTO "AuthSession" (id, "userId", "expiresAt")
     VALUES ($1, $2, (now() AT TIME ZONE 'utc') + interval '1 hour')`,
    [operatorSession, operatorId],
  );
  const CSRF = crypto.randomBytes(32).toString('base64url');
  const operatorCookie = `sso_session=${sealCookie({ authSessionId: operatorSession, csrf: CSRF })}`;
  const consoleOrigin = new URL(consoleRedirect).origin;

  const consoleWithSession = await rawReq('GET', sessionLoginQs(), { cookie: operatorCookie });
  const backToConsole = consoleWithSession.location ? new URL(consoleWithSession.location) : null;
  check('com sessao viva o console volta direto, com o state e sem code',
    consoleWithSession.status === 302
      && `${backToConsole?.origin}${backToConsole?.pathname}` === consoleRedirect
      && backToConsole?.searchParams.get('state') === consoleState
      && !backToConsole?.searchParams.has('code')
      && !backToConsole?.searchParams.has('error'),
    consoleWithSession.location ?? `HTTP ${consoleWithSession.status}`);

  const noRoleInSso = await rawReq('GET', sessionLoginQs(), { cookie: sessionCookie });
  check('quem nao tem papel no SSO volta ao console com access_denied',
    noRoleInSso.status === 302 && new URL(noRoleInSso.location).searchParams.get('error') === 'access_denied',
    noRoleInSso.location ?? `HTTP ${noRoleInSso.status}`);

  const readBySession = await rawReq('GET', '/project', { cookie: operatorCookie });
  check('a API administrativa aceita a sessao do console', readBySession.status === 200,
    `HTTP ${readBySession.status}`);

  const meBySession = await rawReq('GET', '/me', { cookie: operatorCookie });
  check('GET /me pela sessao devolve o token anti-CSRF',
    meBySession.status === 200 && meBySession.json?.csrfToken === CSRF, `HTTP ${meBySession.status}`);
  check('GET /me por Bearer nao devolve token anti-CSRF', me.json?.csrfToken === undefined);

  const emailBySession = `sessao-${tag}@exemplo.com`;
  run.users.push(emailBySession);
  const newUser = { name: 'Criado pela sessao', email: emailBySession };

  const writeNoToken = await rawReq('POST', '/user', { cookie: operatorCookie }, newUser);
  check('escrita pela sessao sem X-CSRF-Token e recusada',
    writeNoToken.status === 403 && writeNoToken.json?.error === 'csrf_token_invalid',
    `HTTP ${writeNoToken.status}`);

  const writeFromOtherOrigin = await rawReq('POST', '/user',
    { cookie: operatorCookie, 'x-csrf-token': CSRF, origin: 'http://evil.example' }, newUser);
  check('token certo vindo de outra origem continua recusado',
    writeFromOtherOrigin.status === 403 && writeFromOtherOrigin.json?.error === 'origin_not_allowed',
    `HTTP ${writeFromOtherOrigin.status}`);
  check('a recusa de origem nao repete a origem recebida',
    !JSON.stringify(writeFromOtherOrigin.json).includes('evil.example'),
    String(writeFromOtherOrigin.json?.message));

  const validWrite = await rawReq('POST', '/user',
    { cookie: operatorCookie, 'x-csrf-token': CSRF, origin: consoleOrigin }, newUser);
  check('escrita pela sessao com token e origem do console passa', validWrite.status === 201,
    `HTTP ${validWrite.status}`);

  const cookieNoToken = `sso_session=${sealCookie({ authSessionId: operatorSession })}`;
  const meNoToken = await rawReq('GET', '/me', { cookie: cookieNoToken });
  check('sessao criada antes da defesa ganha token na primeira chamada',
    meNoToken.status === 200 && typeof meNoToken.json?.csrfToken === 'string'
      && !!cookieOf(meNoToken.cookies, 'sso_session'),
    `HTTP ${meNoToken.status}`);

  const anonymousSession = await rawReq('GET', '/session');
  check('GET /session sem cookie responde sessao inativa',
    anonymousSession.status === 200 && anonymousSession.json?.active === false, `HTTP ${anonymousSession.status}`);

  const activeSession = await rawReq('GET', '/session', { cookie: operatorCookie });
  check('GET /session com sessao devolve quem e e o token anti-CSRF',
    activeSession.json?.active === true && activeSession.json?.csrfToken === CSRF
      && activeSession.json?.user?.email === OPERATOR,
    JSON.stringify(activeSession.json?.user ?? null));

  const sessionNoRole = await rawReq('GET', '/session', { cookie: sessionCookie });
  check('quem nao tem papel no console tambem recebe o token, para conseguir sair',
    sessionNoRole.json?.active === true && typeof sessionNoRole.json?.csrfToken === 'string',
    `HTTP ${sessionNoRole.status}`);

  const signOutNoToken = await rawReq('POST', '/session/logout', { cookie: operatorCookie });
  check('logout do console sem token anti-CSRF e recusado', signOutNoToken.status === 403,
    `HTTP ${signOutNoToken.status}`);

  const signOut = await rawReq('POST', '/session/logout', { cookie: operatorCookie, 'x-csrf-token': CSRF });
  check('logout do console com o token encerra a sessao', signOut.status === 204, `HTTP ${signOut.status}`);

  const afterSignOut = await rawReq('GET', '/project', { cookie: operatorCookie });
  check('depois do logout a mesma sessao nao abre mais nada', afterSignOut.status === 401,
    `HTTP ${afterSignOut.status}`);

  const cleaned = await cleanRun();

  console.log(
    `\nlimpeza: ${cleaned.projects} projeto(s), ${cleaned.users} usuario(s), ` +
      `${run.ssoRoles.length} papel(eis) e ${run.ssoRoutes.length} rota(s) de teste removidos`,
  );

  await db.end();
  console.log(`\n=========== ${pass} passaram, ${fail} falharam ===========\n`);
  process.exit(fail ? 1 : 0);
})().catch(async (e) => {
  console.error('ERRO:', e);
  await cleanRun().catch((failure) => console.error('a limpeza tambem falhou:', failure.message));
  await db.end().catch(() => {});
  process.exit(1);
});
