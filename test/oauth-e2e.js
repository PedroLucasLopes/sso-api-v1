/* Teste ponta a ponta do fluxo OAuth do SSO, sem depender do Google.
 * O login federado e substituido por uma AuthSession inserida direto no banco
 * e pelo cookie de sessao cifrado com a mesma COOKIE_SECRET do servidor.
 *
 * So roda contra banco LOCAL. Ele cria usuarios com papel no projeto do
 * proprio SSO, papeis e rotas, e desfaz tudo no fim; apontado para outro
 * ambiente, seria uma porta administrativa. */
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

// `pg` vem transitivamente de @prisma/adapter-pg.
const { Client } = require('pg');
const {
  ensureOperator,
  mintOperatorToken,
} = require('./lib/operatorToken');
const { limparTestes } = require('./lib/cleanup');

const BASE = process.env.SSO_ISSUER || 'http://localhost:8080/sso';
/* Raiz DESTE repositorio. O teste nao sobe para a pasta de fora: quem clona
 * so o SSO, com qualquer nome de pasta, tem de conseguir rodar a suite. */
const REPO_DIR = path.resolve(__dirname, '..');

/* O teste roda no papel de quem administra o SSO e le a configuracao dele:
 * conexao do banco, COOKIE_SECRET e SSO_LOGIN_URL, do .env.docker. */
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

/* Trava de ambiente, antes de qualquer escrita. Nem o endereco do banco sai
 * no terminal. */
const HOSTS_LOCAIS = new Set(['localhost', '127.0.0.1', 'host.docker.internal']);
const hostDoBanco = (() => {
  try {
    return new URL(env.DATABASE_URL).hostname;
  } catch {
    return '';
  }
})();

if (!HOSTS_LOCAIS.has(hostDoBanco)) {
  console.error('\nEste teste so roda contra banco local. Confira o DATABASE_URL do .env.docker.\n');
  process.exit(1);
}

/* As rotas administrativas exigem `Authorization: Bearer` de um usuario com
 * papel no projeto do proprio SSO. O objeto e preenchido no preparo, depois
 * de o token ser emitido; `api()` le a referencia a cada chamada. */
const ADMIN = { 'content-type': 'application/json' };

/* O operador e a raiz. Os outros dois papeis do SSO sao criados pelo proprio
 * teste, com as rotas marcadas por ele: a suite nao depende de catalogo
 * pre-carregado e roda igual num banco recem-criado. */
const OPERADOR = 'e2e-superadmin@exemplo.com';
const LEITOR = 'e2e-leitor@exemplo.com';
const GESTOR = 'e2e-gestor@exemplo.com';
const COOKIE_KEY = Buffer.from(env.COOKIE_SECRET, 'hex');

// O container alcanca o Postgres por `host.docker.internal`; este teste roda
// na propria maquina, entao fala com ele direto.
const db = new Client({
  connectionString: env.DATABASE_URL.replace('host.docker.internal', '127.0.0.1'),
});

/* O que a rodada criou e precisa sair no fim, por id, nome e e-mail exatos. A
 * limpeza roda tambem quando a rodada quebra no meio: sem isso, um erro deixaria
 * operadores de teste com papel no proprio SSO. */
const rodada = {
  projetos: [],
  usuarios: [OPERADOR, LEITOR, GESTOR],
  papeisDoSso: [],
  nomesDePapeisDoSso: [],
  rotasDoSso: [],
  caminhosDoSso: [],
  urisDoSso: [],
};

async function limparRodada() {
  const limpo = await limparTestes(db, {
    projetos: rodada.projetos.filter(Boolean),
    usuarios: rodada.usuarios.filter(Boolean),
  });

  const sso = (await db.query(`SELECT id FROM "Project" WHERE name = 'SSO'`)).rows[0];

  if (sso) {
    const papeis = [sso.id, rodada.papeisDoSso.filter(Boolean), rodada.nomesDePapeisDoSso];
    const rotas = [sso.id, rodada.rotasDoSso.filter(Boolean), rodada.caminhosDoSso];

    await db.query('DELETE FROM "redirectUri" WHERE "projectId" = $1 AND id = ANY($2)',
      [sso.id, rodada.urisDoSso.filter(Boolean)]);
    await db.query(
      `DELETE FROM "Permission" WHERE "roleId" IN
         (SELECT id FROM "Role" WHERE "projectId" = $1 AND (id = ANY($2) OR name = ANY($3)))`, papeis);
    await db.query('DELETE FROM "Role" WHERE "projectId" = $1 AND (id = ANY($2) OR name = ANY($3))', papeis);
    await db.query(
      `DELETE FROM "Permission" WHERE "routeId" IN
         (SELECT id FROM "Route" WHERE "projectId" = $1 AND (id = ANY($2) OR path = ANY($3)))`, rotas);
    await db.query('DELETE FROM "Route" WHERE "projectId" = $1 AND (id = ANY($2) OR path = ANY($3))', rotas);
  }

  return limpo;
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

// Assercao de cliente private_key_jwt (RFC 7523 secao 2.2).
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

  /* Antes bastava conhecer SSO_ADMIN_SECRET. Agora e preciso ser um usuario
   * com papel no projeto do SSO, e o token sai do fluxo OAuth completo. */
  await ensureOperator(db, { email: OPERADOR, name: 'E2E Superadmin', role: 'SUPERADMIN' });

  const superadmin = await mintOperatorToken(db, {
    issuer: BASE, cookieSecret: env.COOKIE_SECRET, email: OPERADOR,
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
  rodada.projetos.push(projectId);

  const papeisDoProjeto = (await api('GET', `/project/${projectId}/overview`)).json?.roles ?? [];
  check('projeto novo nasce com os papeis padrao SUPERADMIN, ADMIN, MANAGER e VIEWER',
    JSON.stringify(papeisDoProjeto.map((r) => r.name).sort())
      === JSON.stringify(['ADMIN', 'MANAGER', 'SUPERADMIN', 'VIEWER']),
    JSON.stringify(papeisDoProjeto.map((r) => r.name)));
  check('os papeis padrao nascem sem permissao nenhuma',
    papeisDoProjeto.length === 4 && papeisDoProjeto.every((r) => r.permissions.length === 0));

  const papelAdmin = papeisDoProjeto.find((r) => r.name === 'ADMIN');

  await api('POST', '/redirecturi', { projectId, redirectUri: REDIRECT });
  const route = await api('POST', '/route', { path: '/equipment', method: 'GET', projectId });
  await api('POST', '/permission', { roleId: papelAdmin.id, routeId: route.json.id });
  rodada.usuarios.push(`teste-${tag}@exemplo.com`);
  const user = await api('POST', '/user', { name: 'Teste', email: `teste-${tag}@exemplo.com` });
  await api('POST', '/projectuser', { userId: user.json.id, projectId, roleId: papelAdmin.id });

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

  /* O console escolhe o texto pelo codigo, na lingua da tela, e nunca mostra o
   * `message`. Estas asserções prendem o contrato: codigo estavel em `error`, e
   * nada vindo da requisicao nem de dentro do servidor no corpo. */
  check('recusa de negocio vem com codigo', weakRes.json?.error === 'public_key_too_short',
    String(weakRes.json?.error));

  const projetoInexistente = await api('GET', `/project/${crypto.randomUUID()}`);
  check('registro que nao existe vem com codigo e status no corpo',
    projetoInexistente.status === 404 && projetoInexistente.json?.error === 'project_not_found'
      && projetoInexistente.json?.statusCode === 404,
    `HTTP ${projetoInexistente.status} ${projetoInexistente.json?.error}`);

  const nomeRuim = `papel ${tag} <b>`;
  const papelRuim = await api('POST', '/role', { name: nomeRuim, projectId });
  check('validacao do DTO vem como validation_failed, com o codigo do campo',
    papelRuim.status === 400 && papelRuim.json?.error === 'validation_failed'
      && papelRuim.json?.fields?.some((f) => f.field === 'name' && f.error === 'role_name_invalid'),
    JSON.stringify(papelRuim.json?.fields?.map((f) => `${f.field}:${f.error}`)));
  check('a recusa da validacao nao repete o valor enviado', !papelRuim.text.includes(nomeRuim));

  const emailRuim = await api('POST', '/user', { name: 'Sem email', email: 'nao-e-email' });
  check('campo sem regra propria vem com o codigo dele',
    emailRuim.status === 400 && emailRuim.json?.fields?.some((f) => f.field === 'email' && f.error === 'email_invalid'),
    JSON.stringify(emailRuim.json?.fields?.map((f) => `${f.field}:${f.error}`)));

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

  // Substitui o login federado: sessao valida direto no banco.
  const sessionId = crypto.randomUUID();
  /* `expiresAt` e TIMESTAMP sem fuso, e o Prisma grava e le essa coluna sempre
   * em UTC. O `now()` do Postgres devolve a hora local do servidor, que nesta
   * maquina esta em America/Sao_Paulo: a sessao nasceria tres horas no passado
   * e o servidor a descartaria como expirada. `AT TIME ZONE 'utc'` alinha o SQL
   * cru do teste com a convencao do Prisma. */
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

  /* RFC 9207 secao 2: o iss vai em toda resposta de autorizacao, inclusive na
   * de erro, e a secao 2.4 proibe o cliente de supor que um erro veio deste
   * servidor sem conferi-lo. */
  const issDe = (location) => (location ? new URL(location).searchParams.get('iss') : null);
  check('erro devolvido pela redirect_uri tambem traz iss (RFC 9207 secao 2)',
    issDe(badType.location) === BASE, issDe(badType.location) ?? 'ausente');

  // Sessao viva de quem nao tem papel no projeto: a recusa vem depois de
  // client_id e redirect_uri validados, entao volta pela redirect_uri.
  rodada.usuarios.push(`sem-papel-${tag}@exemplo.com`);
  const semPapel = await api('POST', '/user', { name: 'Sem papel', email: `sem-papel-${tag}@exemplo.com` });
  const sessaoSemVinculo = crypto.randomUUID();
  await db.query(
    `INSERT INTO "AuthSession" (id, "userId", "expiresAt")
     VALUES ($1, $2, (now() AT TIME ZONE 'utc') + interval '1 hour')`,
    [sessaoSemVinculo, semPapel.json.id],
  );
  const negado = await api('GET', authorizeQs(), null, {
    cookie: `sso_session=${sealCookie({ authSessionId: sessaoSemVinculo })}`,
  });
  const voltaNegada = negado.location ? new URL(negado.location) : null;
  check('sem papel no projeto, access_denied volta pela redirect_uri com state e iss',
    negado.status === 302
      && voltaNegada?.searchParams.get('error') === 'access_denied'
      && voltaNegada?.searchParams.get('state') === state
      && voltaNegada?.searchParams.get('iss') === BASE,
    negado.location ?? `HTTP ${negado.status}`);

  const authorized = await api('GET', authorizeQs(), null, { cookie: sessionCookie });
  const loc = new URL(authorized.location);
  const code = loc.searchParams.get('code');
  check('sessao viva emite code sem passar pelo Google', !!code, `HTTP ${authorized.status}`);
  check('state e devolvido intacto', loc.searchParams.get('state') === state);
  check('parametro iss presente (RFC 9207, anti mix-up)', loc.searchParams.get('iss') === BASE,
    loc.searchParams.get('iss') ?? 'ausente');

  /* RFC 9207 secao 2.3: quem publica metadados (RFC 8414) anuncia o suporte, e o
   * `issuer` deles e identico ao `iss` das respostas. E contra ele que a secao
   * 2.4 manda o cliente conferir. */
  const metadados = await (await fetch(`${BASE}/.well-known/oauth-authorization-server`)).json();
  check('discovery anuncia authorization_response_iss_parameter_supported (RFC 9207 secao 2.3)',
    metadados.authorization_response_iss_parameter_supported === true,
    String(metadados.authorization_response_iss_parameter_supported));
  check('issuer do discovery identico ao iss do sucesso e do erro (RFC 9207 secao 2.3)',
    metadados.issuer === loc.searchParams.get('iss') && metadados.issuer === voltaNegada?.searchParams.get('iss'),
    `${metadados.issuer} | ${voltaNegada?.searchParams.get('iss') ?? 'ausente'}`);

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

  /* O corpo e recusado pelo ValidationPipe antes do service. No token endpoint a
   * resposta continua a da RFC 6749 secao 5.2, e nao o contrato da API. */
  const grantDesconhecido = await tokenReq({ grant_type: 'password', username: 'x', password: 'y' });
  check('grant_type desconhecido devolve unsupported_grant_type (RFC 6749 secao 5.2)',
    grantDesconhecido.status === 400 && grantDesconhecido.json?.error === 'unsupported_grant_type'
      && grantDesconhecido.cacheControl === 'no-store',
    `HTTP ${grantDesconhecido.status} ${grantDesconhecido.json?.error}`);

  const semGrant = await tokenReq({ code, redirect_uri: REDIRECT });
  check('corpo sem grant_type devolve invalid_request',
    semGrant.status === 400 && semGrant.json?.error === 'invalid_request'
      && typeof semGrant.json?.error_description === 'string',
    `HTTP ${semGrant.status} ${semGrant.json?.error}`);

  // O code foi consumido pela tentativa acima, entao pega um novo.
  const fresh = await api('GET', authorizeQs(), null, { cookie: sessionCookie });
  const code2 = new URL(fresh.location).searchParams.get('code');

  const ok = await tokenReq({
    grant_type: 'authorization_code', code: code2, code_verifier: verifier, redirect_uri: REDIRECT,
    client_assertion_type: 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer',
    client_assertion: clientAssertion(clientId, privateKey),
  });
  // O corpo so aparece na falha: no sucesso ele e o par de tokens.
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
  // RFC 9068 secao 2.2.3.1: o token leva o papel, nao a lista de rotas.
  check('claim roles presente (RFC 9068)', JSON.stringify(v.payload?.roles) === JSON.stringify(['ADMIN']),
    JSON.stringify(v.payload?.roles));
  check('claim perm (hash do conjunto) presente', typeof v.payload?.perm === 'string' && v.payload.perm.length === 12,
    v.payload?.perm);
  check('a lista enumerada de rotas NAO vai no token', v.payload?.permissions === undefined);
  // O cookie de sessao do cliente e o access token + refresh token cifrados.
  // Acima de 4096 bytes o navegador descarta o cookie sem avisar.
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

  const semAuth = await fetch(`${BASE}/oauth/permissions`, form({ role: 'ADMIN' }));
  check('permissions exige autenticacao de cliente', semAuth.status === 401, `HTTP ${semAuth.status}`);
  const lifetime = v.payload.exp - v.payload.iat;
  check('access token curto (<= 15 min)', lifetime <= 900, `${lifetime}s`);

  console.log('\n=== introspeccao (RFC 7662): o que muda no SSO chega sem novo login ===');

  /* Uma pessoa so para isto, com sessao propria: trocar o papel, revogar e tirar
   * do projeto nao pode mexer nos tokens que o resto da suite usa. */
  rodada.usuarios.push(`introspeccao-${tag}@exemplo.com`);
  const inspecionado = await api('POST', '/user', { name: 'Introspeccao', email: `introspeccao-${tag}@exemplo.com` });
  await api('POST', '/projectuser', { userId: inspecionado.json.id, projectId, roleId: papelAdmin.id });
  const sessaoInspecionada = crypto.randomUUID();
  await db.query(
    `INSERT INTO "AuthSession" (id, "userId", "expiresAt")
     VALUES ($1, $2, (now() AT TIME ZONE 'utc') + interval '1 hour')`,
    [sessaoInspecionada, inspecionado.json.id],
  );
  const cookieInspecionado = `sso_session=${sealCookie({ authSessionId: sessaoInspecionada })}`;
  const asercao = () => ({
    client_assertion_type: 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer',
    client_assertion: clientAssertion(clientId, privateKey),
  });
  const parDoInspecionado = async () => {
    const autorizou = await api('GET', authorizeQs(), null, { cookie: cookieInspecionado });
    const codigo = autorizou.location ? new URL(autorizou.location).searchParams.get('code') : null;
    return tokenReq({ grant_type: 'authorization_code', code: codigo, code_verifier: verifier, redirect_uri: REDIRECT, ...asercao() });
  };
  const introspectar = async (token, autenticar = true) => {
    const r = await fetch(`${BASE}/oauth/introspect`, form({ token, token_type_hint: 'access_token', ...(autenticar ? asercao() : {}) }));
    return { status: r.status, json: await r.json().catch(() => null), cacheControl: r.headers.get('cache-control') };
  };

  const metadadosIntrospeccao = await (await fetch(`${BASE}/.well-known/oauth-authorization-server`)).json();
  check('discovery anuncia introspection_endpoint (RFC 8414 secao 2)',
    metadadosIntrospeccao.introspection_endpoint === `${BASE}/oauth/introspect`,
    String(metadadosIntrospeccao.introspection_endpoint));

  const primeiroPar = await parDoInspecionado();
  const ativo = await introspectar(primeiroPar.json?.access_token);
  check('token valido: active, com o papel e o sub da pessoa',
    ativo.status === 200 && ativo.json?.active === true
      && JSON.stringify(ativo.json?.roles) === JSON.stringify(['ADMIN'])
      && ativo.json?.sub === inspecionado.json.id && ativo.json?.client_id === clientId,
    JSON.stringify(ativo.json));
  check('resposta da introspeccao nao vai para cache', ativo.cacheControl === 'no-store', ativo.cacheControl ?? 'ausente');

  // Troca de papel no console: o token continua dizendo ADMIN, a introspeccao nao.
  const papelViewer = papeisDoProjeto.find((r) => r.name === 'VIEWER');
  await api('PUT', `/projectuser/${projectId}/${inspecionado.json.id}`, { roleId: papelViewer.id });
  const depoisDaTroca = await introspectar(primeiroPar.json?.access_token);
  check('trocado o papel, a introspeccao ja responde o papel novo',
    depoisDaTroca.json?.active === true && JSON.stringify(depoisDaTroca.json?.roles) === JSON.stringify(['VIEWER']),
    JSON.stringify(depoisDaTroca.json?.roles));
  check('e o perm do conjunto novo, diferente do que ficou no token',
    typeof depoisDaTroca.json?.perm === 'string' && depoisDaTroca.json.perm !== ativo.json?.perm,
    `${ativo.json?.perm} -> ${depoisDaTroca.json?.perm}`);

  const renovado = await tokenReq({ grant_type: 'refresh_token', refresh_token: primeiroPar.json?.refresh_token, ...asercao() });
  const claimsRenovadas = renovado.json?.access_token ? (await verifyWithJwks(renovado.json.access_token)).payload : null;
  check('o token renovado ja sai com o papel novo',
    JSON.stringify(claimsRenovadas?.roles) === JSON.stringify(['VIEWER']), JSON.stringify(claimsRenovadas?.roles));

  const deOutroCliente = await introspectar(ADMIN.authorization?.slice('Bearer '.length));
  check('token de outro cliente responde inativo, sem dizer mais nada (RFC 7662 secao 4)',
    deOutroCliente.status === 200 && JSON.stringify(deOutroCliente.json) === JSON.stringify({ active: false }),
    JSON.stringify(deOutroCliente.json));

  const lixo = await introspectar('isto.nao.e-um-token');
  check('token que nao verifica responde inativo', lixo.status === 200 && lixo.json?.active === false, JSON.stringify(lixo.json));

  const semCliente = await introspectar(renovado.json?.access_token, false);
  check('introspeccao exige autenticacao de cliente (RFC 7662 secao 2.3)', semCliente.status === 401, `HTTP ${semCliente.status}`);

  // Revogar o grant derruba o access token do mesmo grant (RFC 7009 secao 2.1).
  await fetch(`${BASE}/oauth/revoke`, form({ token: renovado.json?.refresh_token, token_type_hint: 'refresh_token', ...asercao() }));
  const aposRevogar = await introspectar(renovado.json?.access_token);
  check('revogado o grant, o access token dele fica inativo antes de expirar',
    aposRevogar.json?.active === false, JSON.stringify(aposRevogar.json));

  // Tirar do projeto: e o corte de privilegio que precisa valer na hora.
  const segundoPar = await parDoInspecionado();
  const antesDeTirar = await introspectar(segundoPar.json?.access_token);
  await api('DELETE', `/projectuser/${projectId}/${inspecionado.json.id}`);
  const depoisDeTirar = await introspectar(segundoPar.json?.access_token);
  check('tirada do projeto, a pessoa perde o token ativo na introspeccao seguinte',
    antesDeTirar.json?.active === true && depoisDeTirar.json?.active === false,
    `${antesDeTirar.json?.active} -> ${depoisDeTirar.json?.active}`);

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

  /* REGRESSAO, e a mais importante desta secao. Se a rotacao renovasse o
   * vencimento em vez de herda-lo, o refresh token nunca expiraria: bastaria
   * usar a aplicacao de vez em quando para ter sessao eterna, e o
   * REFRESH_TOKEN_TTL viraria enfeite. O teto e absoluto, contado do login. */
  const vencimentoDe = async (raw) =>
    (await db.query('SELECT "expiresAt"::text AS v FROM "RefreshToken" WHERE "tokenHash" = $1',
      [crypto.createHash('sha256').update(raw).digest('hex')])).rows[0]?.v;

  const tetoOriginal = await vencimentoDe(pair1.json.refresh_token);
  const tetoRotacionado = await vencimentoDe(refreshed.json.refresh_token);

  check('a rotacao HERDA o vencimento, nao o estende (sessao nao vira eterna)',
    !!tetoOriginal && tetoOriginal === tetoRotacionado,
    `${tetoOriginal} -> ${tetoRotacionado}`);

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

  /* A RFC 7009 secao 2 pede MUST para refresh token e SHOULD para access
   * token; a secao 2.1 manda invalidar o que saiu do mesmo grant. Aqui os dois
   * tipos derrubam a mesma familia. */
  const novaTroca = async () => {
    const v = crypto.randomBytes(32).toString('base64url');
    const c = crypto.createHash('sha256').update(v, 'ascii').digest('base64url');
    const q = new URLSearchParams({
      client_id: clientId, redirect_uri: REDIRECT, response_type: 'code',
      code_challenge: c, code_challenge_method: 'S256', state: crypto.randomBytes(8).toString('base64url'),
    });
    const r = await api('GET', `/oauth/authorize?${q}`, null, { cookie: sessionCookie });
    const codigo = new URL(r.location).searchParams.get('code');
    return tokenReq({
      grant_type: 'authorization_code', code: codigo, code_verifier: v, redirect_uri: REDIRECT,
      client_assertion_type: 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer',
      client_assertion: clientAssertion(clientId, privateKey),
    });
  };

  const vivos = async () =>
    (await db.query(
      `SELECT count(*)::int AS n FROM "RefreshToken"
        WHERE "authSessionId" = $1 AND "projectId" = $2 AND "revokedAt" IS NULL`,
      [sessionId, projectId],
    )).rows[0].n;

  const parA = await novaTroca();
  const claimsA = JSON.parse(
    Buffer.from(parA.json.access_token.split('.')[1], 'base64url').toString(),
  );

  check('o access token carrega sid, a ancora de revogacao (RFC 9068 secao 2.2.1)',
    claimsA.sid === sessionId, claimsA.sid ?? 'ausente');

  check('havia refresh token vivo antes de revogar', (await vivos()) > 0);

  const revogaPorAccess = await fetch(`${BASE}/oauth/revoke`, form({
    token: parA.json.access_token,
    token_type_hint: 'access_token',
    client_assertion_type: 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer',
    client_assertion: clientAssertion(clientId, privateKey),
  }));
  check('revoke aceitando ACCESS token responde 200', revogaPorAccess.ok, `HTTP ${revogaPorAccess.status}`);
  check('e derruba a familia de refresh tokens do mesmo grant',
    (await vivos()) === 0, `${await vivos()} vivo(s)`);

  const renovarDepois = await tokenReq({
    grant_type: 'refresh_token', refresh_token: parA.json.refresh_token,
    client_assertion_type: 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer',
    client_assertion: clientAssertion(clientId, privateKey),
  });
  check('depois disso o refresh token nao renova mais',
    renovarDepois.status === 400 && renovarDepois.json?.error === 'invalid_grant',
    `HTTP ${renovarDepois.status} ${renovarDepois.json?.error ?? ''}`);

  // Um cliente nao derruba a sessao de outro apresentando um token capturado.
  const parB = await novaTroca();
  const outroProjeto = await api('POST', '/project', { name: `intruso-${tag}` });
  rodada.projetos.push(outroProjeto.json?.id);
  const intrusoKey = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  await api('POST', '/clientkey', { projectId: outroProjeto.json.id, publicKeyPem: intrusoKey.publicKey });
  // Precisa estar ATIVO, senao o 401 viria do portao de ativacao e o teste
  // nao provaria nada sobre revogacao.
  await api('PATCH', `/project/${outroProjeto.json.id}/status`, { status: 'ACTIVE' });

  const tentativa = await fetch(`${BASE}/oauth/revoke`, form({
    token: parB.json.access_token,
    token_type_hint: 'access_token',
    client_assertion_type: 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer',
    client_assertion: clientAssertion(outroProjeto.json.clientId, intrusoKey.privateKey),
  }));
  check('outro cliente apresentando o token capturado recebe 200 mas nao revoga nada',
    tentativa.ok && (await vivos()) > 0, `HTTP ${tentativa.status}, ${await vivos()} vivo(s)`);


  console.log('\n=== autorizacao administrativa vem do banco ===');

  const adminReq = async (method, rota, headers, body) => {
    const res = await fetch(`${BASE}${rota}`, {
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

  const semCredencial = await adminReq('GET', '/project', {});
  check('rota administrativa sem Bearer devolve 401',
    semCredencial.status === 401, `HTTP ${semCredencial.status}`);
  check('401 administrativo traz WWW-Authenticate (RFC 6750 secao 3)',
    !!semCredencial.wwwAuth, semCredencial.wwwAuth ?? 'ausente');

  // O segredo estatico saiu do codigo; se algum resto dele voltar, isto quebra.
  const segredoAntigo = await adminReq('GET', '/project', {
    'x-sso-secret': env.SSO_ADMIN_SECRET ?? 'segredo-que-nao-existe-mais',
  });
  check('x-sso-secret nao abre mais nada',
    segredoAntigo.status === 401, `HTTP ${segredoAntigo.status}`);

  // Mesmo emissor, mesma assinatura, outro `aud`: nao serve aqui.
  const tokenDeOutroProjeto = await adminReq('GET', '/project', {
    authorization: `Bearer ${ok.json.access_token}`,
  });
  check('token de outra aplicacao nao vira credencial administrativa',
    tokenDeOutroProjeto.status === 401, `HTTP ${tokenDeOutroProjeto.status}`);

  const superHeaders = { authorization: `Bearer ${superadmin.token}` };

  const me = await adminReq('GET', '/me', superHeaders);
  check('GET /me devolve o papel lido do banco',
    me.status === 200 && me.json?.role === 'SUPERADMIN', `HTTP ${me.status} ${me.json?.role ?? ''}`);
  check('GET /me marca a raiz, que nao depende do catalogo', me.json?.root === true, String(me.json?.root));

  /* Num ambiente novo o catalogo do SSO esta vazio. A raiz recebe a lista do
   * proprio roteador, senao entraria num console sem menu justamente quando
   * precisa cadastrar tudo. */
  const rotasDaRaiz = new Set((me.json?.permissions ?? []).map((p) => `${p.method} ${p.path}`));
  const foraDoRbac = (rota) => rota === 'GET /me' || / \/(oauth|session|login|\.well-known|health)\b/.test(rota);
  check('para a raiz, GET /me lista toda rota administrativa do servidor, cadastrada ou nao',
    ['GET /project', 'POST /role', 'PUT /projectuser/:projectId/:userId', 'DELETE /projectuser/:projectId/:userId',
      'POST /clientkey/generate'].every((rota) => rotasDaRaiz.has(rota)),
    `${rotasDaRaiz.size} rota(s)`);
  check('rota publica ou so autenticada fica fora da lista da raiz',
    rotasDaRaiz.size > 0 && ![...rotasDaRaiz].some(foraDoRbac),
    [...rotasDaRaiz].filter(foraDoRbac).join(', ') || 'nenhuma');

  console.log('\n=== papeis do SSO criados pela raiz, rota a rota ===');

  /* Nenhuma rota ou permissao administrativa vem pre-cadastrada para este
   * teste: ele usa as rotas que existirem e cria as que faltarem, como a raiz
   * faria num banco recem-criado. */
  const ssoId = (await db.query(`SELECT id FROM "Project" WHERE name = 'SSO'`)).rows[0].id;

  const rotaDoSso = async (method, caminho) => {
    const existente = (await db.query(
      'SELECT id FROM "Route" WHERE "projectId" = $1 AND path = $2 AND method = $3::"Method"',
      [ssoId, caminho, method],
    )).rows[0];

    if (existente) return existente.id;

    const criada = await api('POST', '/route', { projectId: ssoId, path: caminho, method });

    if (criada.status !== 201) throw new Error(`a raiz nao cadastrou ${method} ${caminho}: HTTP ${criada.status}`);

    rodada.rotasDoSso.push(criada.json.id);
    return criada.json.id;
  };

  const papelDoSso = async (nome, rotas) => {
    const criado = await api('POST', '/role', { projectId: ssoId, name: nome });

    if (criado.status !== 201) throw new Error(`a raiz nao criou o papel ${nome}: HTTP ${criado.status}`);

    rodada.papeisDoSso.push(criado.json.id);

    for (const [method, caminho] of rotas) {
      const concedida = await api('POST', '/permission', {
        roleId: criado.json.id, routeId: await rotaDoSso(method, caminho),
      });

      if (concedida.status !== 201) throw new Error(`a raiz nao concedeu ${method} ${caminho}: HTTP ${concedida.status}`);
    }

    return criado.json;
  };

  const PAPEL_LEITOR = `E2E_LEITOR_${TAG}`;
  const PAPEL_GESTOR = `E2E_GESTOR_${TAG}`;

  const leitor = await papelDoSso(PAPEL_LEITOR, [['GET', '/project']]);
  const gestor = await papelDoSso(PAPEL_GESTOR, [
    ['GET', '/project'],
    ['POST', '/role'], ['PUT', '/role/:id'], ['DELETE', '/role/:id'],
    ['POST', '/route'], ['PUT', '/route/:id'], ['DELETE', '/route/:id'],
    ['POST', '/permission'], ['DELETE', '/permission/:id'],
    ['POST', '/projectuser'], ['PUT', '/projectuser/:projectId/:userId'], ['DELETE', '/projectuser/:projectId/:userId'],
    ['PUT', '/redirecturi/:id'], ['DELETE', '/redirecturi/:id'],
  ]);
  check('a raiz cria no SSO papeis com nome livre e marca as rotas de cada um', !!leitor.id && !!gestor.id);

  await ensureOperator(db, { email: LEITOR, name: 'E2E Leitor', role: PAPEL_LEITOR });
  await ensureOperator(db, { email: GESTOR, name: 'E2E Gestor', role: PAPEL_GESTOR });

  const leitorToken = await mintOperatorToken(db, { issuer: BASE, cookieSecret: env.COOKIE_SECRET, email: LEITOR });
  const gestorToken = await mintOperatorToken(db, { issuer: BASE, cookieSecret: env.COOKIE_SECRET, email: GESTOR });
  const leitorHeaders = { authorization: `Bearer ${leitorToken.token}` };
  const gestorHeaders = { authorization: `Bearer ${gestorToken.token}` };

  const leitorLe = await adminReq('GET', '/project', leitorHeaders);
  check('papel com GET /project le o catalogo', leitorLe.status === 200, `HTTP ${leitorLe.status}`);

  const meDoLeitor = await adminReq('GET', '/me', leitorHeaders);
  check('GET /me lista as permissoes de quem nao e raiz',
    meDoLeitor.json?.root === false && meDoLeitor.json?.permissions?.length === 1,
    `${meDoLeitor.json?.permissions?.length ?? 0} rota(s)`);

  console.log('\n=== sem permissao, 404 como caminho inexistente (RFC 9110 secao 15.5.4) ===');

  const leitorEscreve = await adminReq('POST', '/project', leitorHeaders, { name: `proibido-${tag}` });
  const caminhoInexistente = await adminReq('POST', `/nao-existe-${tag}`, leitorHeaders, { name: 'x' });
  check('papel sem POST /project recebe 404', leitorEscreve.status === 404, `HTTP ${leitorEscreve.status}`);
  check('o 404 da rota negada e igual ao de um caminho que nao existe',
    leitorEscreve.json?.message === 'Cannot POST /sso/project'
      && caminhoInexistente.status === 404
      && caminhoInexistente.json?.message === `Cannot POST /sso/nao-existe-${tag}`
      && leitorEscreve.json?.error === caminhoInexistente.json?.error,
    `${leitorEscreve.json?.message} | ${caminhoInexistente.json?.message}`);
  check('o 404 da rota negada nao anuncia como se autentica',
    !leitorEscreve.wwwAuth && !caminhoInexistente.wwwAuth, leitorEscreve.wwwAuth ?? 'sem WWW-Authenticate');

  const gestorGeraChave = await adminReq('POST', '/clientkey/generate', gestorHeaders, { projectId });
  check('papel sem permissao de gerar chave recebe 404', gestorGeraChave.status === 404, `HTTP ${gestorGeraChave.status}`);

  const superGeraChave = await adminReq('POST', '/clientkey/generate', superHeaders, { projectId });
  check('a raiz gera a chave privada',
    superGeraChave.status === 201 && !!superGeraChave.json?.privateKeyBase64,
    `HTTP ${superGeraChave.status}`);
  check('a chave privada nao fica gravada, so volta na resposta',
    superGeraChave.json?.privateKeyBase64?.length > 0 && !superGeraChave.json?.id?.includes('.'),
    `id ${superGeraChave.json?.id ?? 'ausente'}`);

  /* O papel e relido a cada requisicao, entao tirar o vinculo faz efeito
   * imediato: o access token continua valido e assinado, e mesmo assim para
   * de abrir porta. Era o que o segredo estatico nao permitia. */
  await db.query(
    'DELETE FROM "ProjectUser" WHERE "userId" = $1 AND "projectId" = $2',
    [leitorToken.userId, ssoId],
  );
  const depoisDeRevogar = await adminReq('GET', '/project', leitorHeaders);
  check('tirar o vinculo derruba o acesso sem esperar o token expirar',
    depoisDeRevogar.status === 404, `HTTP ${depoisDeRevogar.status}`);
  await ensureOperator(db, { email: LEITOR, name: 'E2E Leitor', role: PAPEL_LEITOR });

  console.log('\n=== papeis customizados nas aplicacoes ===');

  const arquiteto = await adminReq('POST', '/role', gestorHeaders, { projectId, name: 'ARQUITETO' });
  check('gestor cria o papel ARQUITETO numa aplicacao', arquiteto.status === 201, `HTTP ${arquiteto.status}`);

  const nomeForaDoPadrao = await adminReq('POST', '/role', gestorHeaders, { projectId, name: 'arquiteto' });
  check('nome de papel fora do padrao e recusado (400)', nomeForaDoPadrao.status === 400, `HTTP ${nomeForaDoPadrao.status}`);

  const papelRepetido = await adminReq('POST', '/role', gestorHeaders, { projectId, name: 'ARQUITETO' });
  check('nome de papel repetido no mesmo projeto e recusado (409)', papelRepetido.status === 409, `HTTP ${papelRepetido.status}`);

  const concedeAoArquiteto = await adminReq('POST', '/permission', gestorHeaders, {
    roleId: arquiteto.json?.id, routeId: route.json.id,
  });
  check('gestor marca a rota que o ARQUITETO alcanca', concedeAoArquiteto.status === 201, `HTTP ${concedeAoArquiteto.status}`);

  const conjuntoDoArquiteto = await fetch(`${BASE}/oauth/permissions`, form({
    role: 'ARQUITETO',
    client_assertion_type: 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer',
    client_assertion: clientAssertion(clientId, privateKey),
  }));
  const permissoesDoArquiteto = conjuntoDoArquiteto.ok ? await conjuntoDoArquiteto.json() : null;
  check('a aplicacao resolve as rotas do papel customizado',
    JSON.stringify(permissoesDoArquiteto?.permissions) === JSON.stringify([{ path: '/equipment', method: 'GET' }]),
    JSON.stringify(permissoesDoArquiteto?.permissions));

  console.log('\n=== trocar o papel de alguem e tirar alguem do projeto ===');

  rodada.usuarios.push(`colega-${tag}@exemplo.com`);
  const colega = await api('POST', '/user', { name: 'Colega', email: `colega-${tag}@exemplo.com` });
  const vinculaColega = await adminReq('POST', '/projectuser', gestorHeaders, {
    userId: colega.json.id, projectId, roleId: papelAdmin.id,
  });
  check('gestor vincula uma pessoa a uma aplicacao', vinculaColega.status === 201, `HTTP ${vinculaColega.status}`);

  const trocaDePapel = await adminReq('PUT', `/projectuser/${projectId}/${colega.json.id}`, gestorHeaders, {
    roleId: arquiteto.json?.id,
  });
  check('gestor troca o papel da pessoa, e o novo substitui o anterior',
    trocaDePapel.status === 200 && trocaDePapel.json?.roleId === arquiteto.json?.id, `HTTP ${trocaDePapel.status}`);

  const papelDeOutroProjeto = await adminReq('PUT', `/projectuser/${projectId}/${colega.json.id}`, gestorHeaders, {
    roleId: leitor.id,
  });
  check('papel de outro projeto nao serve para a troca (400)', papelDeOutroProjeto.status === 400, `HTTP ${papelDeOutroProjeto.status}`);

  // Um refresh token vivo da pessoa neste projeto, para ver a remocao derruba-lo.
  await db.query(
    `INSERT INTO "RefreshToken" (id, "tokenHash", "familyId", "userId", "projectId", "authSessionId", "expiresAt")
     VALUES ($1, $2, $3, $4, $5, $6, (now() AT TIME ZONE 'utc') + interval '1 hour')`,
    [crypto.randomUUID(), crypto.randomBytes(32).toString('hex'), crypto.randomUUID(), colega.json.id, projectId, sessionId],
  );

  const tiraColega = await adminReq('DELETE', `/projectuser/${projectId}/${colega.json.id}`, gestorHeaders);
  const refreshDoColega = (await db.query(
    'SELECT count(*)::int AS n FROM "RefreshToken" WHERE "userId" = $1 AND "projectId" = $2 AND "revokedAt" IS NULL',
    [colega.json.id, projectId],
  )).rows[0].n;
  check('gestor tira a pessoa do projeto (204)', tiraColega.status === 204, `HTTP ${tiraColega.status}`);
  check('tirar do projeto revoga os refresh tokens da pessoa ali', refreshDoColega === 0, `${refreshDoColega} vivo(s)`);

  const tiraDeNovo = await adminReq('DELETE', `/projectuser/${projectId}/${colega.json.id}`, gestorHeaders);
  check('tirar quem ja saiu devolve 404', tiraDeNovo.status === 404, `HTTP ${tiraDeNovo.status}`);

  console.log('\n=== apagar quem nao tem mais projeto ===');

  /* Quem saiu de todos os projetos ainda tem sessao com o SSO, code e refresh
   * token. Nada disso e acesso, e nada disso pode prender o cadastro: a chave
   * estrangeira de AuthSession recusava apagar o User e a resposta virava 500. */
  rodada.usuarios.push(`ocioso-${tag}@exemplo.com`);
  const ocioso = await api('POST', '/user', { name: 'Ocioso', email: `ocioso-${tag}@exemplo.com` });
  const sessaoDoOcioso = crypto.randomUUID();
  await db.query(
    `INSERT INTO "AuthSession" (id, "userId", "expiresAt")
     VALUES ($1, $2, (now() AT TIME ZONE 'utc') + interval '1 hour')`,
    [sessaoDoOcioso, ocioso.json.id],
  );
  const refreshDoOcioso = crypto.randomBytes(32).toString('base64url');
  await db.query(
    `INSERT INTO "RefreshToken" (id, "tokenHash", "familyId", "userId", "projectId", "authSessionId", "expiresAt")
     VALUES ($1, $2, $3, $4, $5, $6, (now() AT TIME ZONE 'utc') + interval '1 hour')`,
    [crypto.randomUUID(), crypto.createHash('sha256').update(refreshDoOcioso).digest('hex'),
      crypto.randomUUID(), ocioso.json.id, projectId, sessaoDoOcioso],
  );
  await db.query(
    `INSERT INTO "AuthorizationCode"
       (id, "codeHash", "userId", "projectId", "authSessionId", "redirectUri", "codeChallenge", "expiresAt")
     VALUES ($1, $2, $3, $4, $5, $6, $7, (now() AT TIME ZONE 'utc') + interval '5 minutes')`,
    [crypto.randomUUID(), crypto.randomBytes(32).toString('hex'), ocioso.json.id, projectId,
      sessaoDoOcioso, REDIRECT, challenge],
  );

  await api('POST', '/projectuser', { userId: ocioso.json.id, projectId, roleId: papelAdmin.id });
  const apagaComProjeto = await api('DELETE', `/user/${ocioso.json.id}`);
  const sessoesDepoisDaRecusa = (await db.query(
    'SELECT count(*)::int AS n FROM "AuthSession" WHERE "userId" = $1', [ocioso.json.id],
  )).rows[0].n;
  check('quem ainda tem projeto nao se apaga (400), e nada dela e tocado',
    apagaComProjeto.status === 400 && sessoesDepoisDaRecusa === 1,
    `HTTP ${apagaComProjeto.status}, ${sessoesDepoisDaRecusa} sessao(oes)`);

  await api('DELETE', `/projectuser/${projectId}/${ocioso.json.id}`);
  const apagado = await api('DELETE', `/user/${ocioso.json.id}`);
  check('sem projeto, apagar passa mesmo com sessao, code e refresh token (204)',
    apagado.status === 204, `HTTP ${apagado.status}`);

  const sobras = (await db.query(
    `SELECT
       (SELECT count(*)::int FROM "User" WHERE id = $1) AS usuario,
       (SELECT count(*)::int FROM "AuthSession" WHERE "userId" = $1) AS sessoes,
       (SELECT count(*)::int FROM "RefreshToken" WHERE "userId" = $1 OR "authSessionId" = $2) AS refresh,
       (SELECT count(*)::int FROM "AuthorizationCode" WHERE "userId" = $1 OR "authSessionId" = $2) AS codes`,
    [ocioso.json.id, sessaoDoOcioso],
  )).rows[0];
  check('a exclusao leva junto a sessao, os refresh tokens e os codes da pessoa',
    Object.values(sobras).every((n) => n === 0), JSON.stringify(sobras));

  /* RFC 7009 secao 2.1: apagar vale como revogar o grant. O token que ela tinha
   * na mao nao renova mais nada. */
  const refreshDeApagado = await tokenReq({
    grant_type: 'refresh_token', refresh_token: refreshDoOcioso,
    client_assertion_type: 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer',
    client_assertion: clientAssertion(clientId, privateKey),
  });
  check('o refresh token de quem foi apagado nao renova mais',
    refreshDeApagado.status === 400 && refreshDeApagado.json?.error === 'invalid_grant',
    `HTTP ${refreshDeApagado.status} ${refreshDeApagado.json?.error ?? ''}`);

  const sessaoDeApagado = await api('GET', authorizeQs(), null, {
    cookie: `sso_session=${sealCookie({ authSessionId: sessaoDoOcioso })}`,
  });
  check('a sessao dela no SSO morre junto: o authorize volta a tela de login',
    sessaoDeApagado.status === 302 && sessaoDeApagado.location === env.SSO_LOGIN_URL,
    sessaoDeApagado.location ?? `HTTP ${sessaoDeApagado.status}`);

  const apagarUsuarioDeNovo = await api('DELETE', `/user/${ocioso.json.id}`);
  check('apagar quem ja saiu do banco devolve 404', apagarUsuarioDeNovo.status === 404,
    `HTTP ${apagarUsuarioDeNovo.status}`);

  console.log('\n=== gestao: o overview traz os ids que editar exige ===');

  const visao = await api('GET', `/project/${projectId}/overview`);
  const permissaoVista = visao.json?.roles?.find((r) => r.name === 'ADMIN')?.permissions?.[0];
  check('overview traz o id de cada redirect URI',
    !!visao.json?.redirectUriRecords?.[0]?.id, JSON.stringify(visao.json?.redirectUriRecords ?? null));
  check('overview traz id e routeId de cada permissao, para DELETE /permission/:id',
    !!permissaoVista?.id && permissaoVista?.routeId === route.json.id, JSON.stringify(permissaoVista ?? null));

  const uriComCampoAMais = await api('POST', '/redirecturi', {
    projectId, redirectUri: 'http://localhost:3999/cb', inesperado: true,
  });
  check('POST /redirecturi valida o corpo pelo DTO e recusa campo a mais',
    uriComCampoAMais.status === 400, `HTTP ${uriComCampoAMais.status}`);

  console.log('\n=== gestao: apagar redirect URI ===');

  const EXTRA = 'http://localhost:3999/api/auth/callback';
  const extra = await api('POST', '/redirecturi', { projectId, redirectUri: EXTRA });
  check('um segundo endereco entra no projeto', extra.status === 201, `HTTP ${extra.status}`);

  /* Um code emitido para o endereco enquanto ele ainda existe. Quem apaga a
   * redirect_uri espera que ela pare de servir na hora, e nao quando os codes
   * em transito expirarem. */
  const verifierExtra = crypto.randomBytes(32).toString('base64url');
  const autorizaExtra = await api('GET', `/oauth/authorize?${new URLSearchParams({
    client_id: clientId, redirect_uri: EXTRA, response_type: 'code', code_challenge_method: 'S256',
    code_challenge: crypto.createHash('sha256').update(verifierExtra, 'ascii').digest('base64url'),
    state: crypto.randomBytes(16).toString('base64url'),
  })}`, null, { cookie: sessionCookie });
  const codeExtra = autorizaExtra.location ? new URL(autorizaExtra.location).searchParams.get('code') : null;
  check('com sessao viva o SSO emite code para o segundo endereco', !!codeExtra, `HTTP ${autorizaExtra.status}`);

  const leitorApaga = await adminReq('DELETE', `/redirecturi/${extra.json?.id}`, leitorHeaders);
  check('papel sem DELETE /redirecturi/:id recebe 404', leitorApaga.status === 404, `HTTP ${leitorApaga.status}`);

  const apagou = await adminReq('DELETE', `/redirecturi/${extra.json?.id}`, gestorHeaders);
  check('gestor apaga redirect URI de uma aplicacao (204)', apagou.status === 204, `HTTP ${apagou.status}`);

  const apagarDeNovo = await adminReq('DELETE', `/redirecturi/${extra.json?.id}`, gestorHeaders);
  check('apagar o que ja saiu devolve 404', apagarDeNovo.status === 404, `HTTP ${apagarDeNovo.status}`);

  const enderecos = (await api('GET', `/project/${projectId}/overview`)).json?.redirectUriRecords
    ?.map((r) => r.redirectUri) ?? [];
  check('o overview perde so o endereco apagado',
    !enderecos.includes(EXTRA) && enderecos.includes(REDIRECT), JSON.stringify(enderecos));

  const authorizeApagado = await api('GET', `/oauth/authorize?${new URLSearchParams({
    client_id: clientId, redirect_uri: EXTRA,
  })}`, null, {});
  check('authorize com o endereco apagado NAO redireciona',
    authorizeApagado.status === 400 && !authorizeApagado.location, `HTTP ${authorizeApagado.status}`);

  const trocaAposApagar = await tokenReq({
    grant_type: 'authorization_code', code: codeExtra, code_verifier: verifierExtra, redirect_uri: EXTRA,
    client_assertion_type: 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer',
    client_assertion: clientAssertion(clientId, privateKey),
  });
  check('code emitido antes de apagar o endereco nao vira token',
    trocaAposApagar.status === 400 && trocaAposApagar.json?.error === 'invalid_grant',
    `HTTP ${trocaAposApagar.status} ${trocaAposApagar.json?.error_description ?? ''}`);

  console.log('\n=== gestao: apagar projeto ===');

  /* Todo projeto nasce com os quatro papeis padrao. Apagar um projeto sem rotas
   * nem membros leva junto os papeis, as redirect URIs e as chaves dele; sem
   * isso a chave estrangeira devolvia 500 e nenhum projeto se apagava. */
  const descartavel = await api('POST', '/project', { name: `descartavel-${tag}` });
  rodada.projetos.push(descartavel.json?.id);
  await api('POST', '/redirecturi', { projectId: descartavel.json?.id, redirectUri: 'http://localhost:3998/api/auth/callback' });
  await api('POST', '/clientkey/generate', { projectId: descartavel.json?.id });
  const rotaDescartavel = await api('POST', '/route', { projectId: descartavel.json?.id, path: '/rascunho', method: 'GET' });

  const apagarComRota = await api('DELETE', `/project/${descartavel.json?.id}`);
  check('projeto com rota nao se apaga (400)', apagarComRota.status === 400, `HTTP ${apagarComRota.status}`);

  await api('DELETE', `/route/${rotaDescartavel.json?.id}`);
  const apagarProjeto = await api('DELETE', `/project/${descartavel.json?.id}`);
  const depoisDeApagar = await api('GET', `/project/${descartavel.json?.id}/overview`);
  check('projeto sem rotas nem membros se apaga com papeis padrao, redirect URI e chave (204)',
    apagarProjeto.status === 204 && depoisDeApagar.status === 404,
    `HTTP ${apagarProjeto.status}, overview ${depoisDeApagar.status}`);

  console.log('\n=== o projeto do proprio SSO: so a raiz mexe, e nem ela desmonta ===');

  /* Cada tentativa mira algo que nao destruiria o ambiente se a protecao
   * falhasse: valores iguais aos atuais, papeis e rotas do proprio teste, chave
   * estrangeira que impede a exclusao, e o estado original devolvido quando
   * uma tentativa passa. */
  const protegido = (r) => r.status === 403 && r.json?.error === 'sso_project_protected';
  const detalhe = (r) => `HTTP ${r.status} ${r.json?.error ?? ''}`;

  const apagarSso = await api('DELETE', `/project/${ssoId}`);
  check('nem a raiz apaga o projeto SSO', protegido(apagarSso), detalhe(apagarSso));

  const renomearSso = await api('PUT', `/project/${ssoId}`, { name: 'SSO' });
  check('nem a raiz renomeia o projeto SSO', protegido(renomearSso), detalhe(renomearSso));

  const suspenderSso = await api('PATCH', `/project/${ssoId}/status`, { status: 'SUSPENDED' });
  if (suspenderSso.status < 300) {
    await db.query(`UPDATE "Project" SET status = 'ACTIVE', "suspendedAt" = NULL WHERE id = $1`, [ssoId]);
  }
  check('nem a raiz tira o projeto SSO de ACTIVE', protegido(suspenderSso), detalhe(suspenderSso));

  const raizDoSso = (await db.query(
    `SELECT id FROM "Role" WHERE "projectId" = $1 AND name = 'SUPERADMIN'`, [ssoId])).rows[0];

  const renomearRaiz = await api('PUT', `/role/${raizDoSso.id}`, { name: `SUPERADMIN_${TAG}` });
  if (renomearRaiz.status < 300) {
    // A protecao falhou: devolve o nome antes que a raiz deixe de existir.
    await db.query(`UPDATE "Role" SET name = 'SUPERADMIN' WHERE id = $1`, [raizDoSso.id]);
  }
  check('o papel SUPERADMIN do SSO nao se renomeia', protegido(renomearRaiz), detalhe(renomearRaiz));

  const apagarRaiz = await api('DELETE', `/role/${raizDoSso.id}`);
  check('o papel SUPERADMIN do SSO nao se apaga', protegido(apagarRaiz), detalhe(apagarRaiz));

  rodada.nomesDePapeisDoSso.push(`E2E_TEMPORARIO_${TAG}`, `E2E_TENTATIVA_${TAG}`);
  const papelTemporarioNoSso = await api('POST', '/role', { projectId: ssoId, name: `E2E_TEMPORARIO_${TAG}` });
  const apagaTemporarioNoSso = await api('DELETE', `/role/${papelTemporarioNoSso.json?.id}`);
  check('a raiz cria e apaga papel de gestao no SSO',
    papelTemporarioNoSso.status === 201 && apagaTemporarioNoSso.status === 204,
    `${detalhe(papelTemporarioNoSso)} / ${detalhe(apagaTemporarioNoSso)}`);

  const CAMINHO_TENTATIVA = `/e2e-tentativa-${tag}`;
  rodada.caminhosDoSso.push(CAMINHO_TENTATIVA);
  const gestorCriaRota = await adminReq('POST', '/route', gestorHeaders, { projectId: ssoId, path: CAMINHO_TENTATIVA, method: 'GET' });
  check('papel de gestao nao cria rota no SSO', protegido(gestorCriaRota), detalhe(gestorCriaRota));

  const rotaDeLeitura = await rotaDoSso('GET', '/project');
  const gestorEditaRota = await adminReq('PUT', `/route/${rotaDeLeitura}`, gestorHeaders, { path: '/project' });
  check('papel de gestao nao edita rota do SSO', protegido(gestorEditaRota), detalhe(gestorEditaRota));

  const gestorApagaRota = await adminReq('DELETE', `/route/${rotaDeLeitura}`, gestorHeaders);
  check('papel de gestao nao apaga rota do SSO', protegido(gestorApagaRota), detalhe(gestorApagaRota));

  const gestorCriaPapel = await adminReq('POST', '/role', gestorHeaders, { projectId: ssoId, name: `E2E_TENTATIVA_${TAG}` });
  check('papel de gestao nao cria papel no SSO', protegido(gestorCriaPapel), detalhe(gestorCriaPapel));

  const gestorEditaPapel = await adminReq('PUT', `/role/${leitor.id}`, gestorHeaders, { name: PAPEL_LEITOR });
  check('papel de gestao nao edita papel do SSO', protegido(gestorEditaPapel), detalhe(gestorEditaPapel));

  const gestorApagaPapel = await adminReq('DELETE', `/role/${leitor.id}`, gestorHeaders);
  check('papel de gestao nao apaga papel do SSO', protegido(gestorApagaPapel), detalhe(gestorApagaPapel));

  const gestorConcede = await adminReq('POST', '/permission', gestorHeaders, {
    roleId: leitor.id, routeId: await rotaDoSso('POST', '/role'),
  });
  check('papel de gestao nao concede permissao no SSO', protegido(gestorConcede), detalhe(gestorConcede));

  const permissaoDoLeitor = (await db.query(
    'SELECT id FROM "Permission" WHERE "roleId" = $1 LIMIT 1', [leitor.id])).rows[0];
  const gestorRevoga = await adminReq('DELETE', `/permission/${permissaoDoLeitor.id}`, gestorHeaders);
  check('papel de gestao nao revoga permissao no SSO', protegido(gestorRevoga), detalhe(gestorRevoga));

  const escalada = await adminReq('POST', '/projectuser', gestorHeaders, {
    userId: colega.json.id, projectId: ssoId, roleId: raizDoSso.id,
  });
  if (escalada.status < 300) {
    await db.query('DELETE FROM "ProjectUser" WHERE "userId" = $1 AND "projectId" = $2', [colega.json.id, ssoId]);
  }
  check('papel de gestao nao coloca ninguem como SUPERADMIN (escalada de privilegio)', protegido(escalada), detalhe(escalada));

  const vinculaPelaRaiz = await api('POST', '/projectuser', { userId: colega.json.id, projectId: ssoId, roleId: leitor.id });
  const desvinculaPelaRaiz = await api('DELETE', `/projectuser/${ssoId}/${colega.json.id}`);
  check('a raiz vincula e desvincula pessoas no SSO',
    vinculaPelaRaiz.status === 201 && desvinculaPelaRaiz.status === 204,
    `${detalhe(vinculaPelaRaiz)} / ${detalhe(desvinculaPelaRaiz)}`);

  /* "O SSO nunca fica sem SUPERADMIN" nao se prova aqui: o operador desta suite
   * ja e um segundo SUPERADMIN, e chegar ao ultimo exigiria rebaixar a raiz real
   * do ambiente. A regra tem teste proprio em
   * src/global/access/selfProjectProtection.spec.ts. */

  const urisDoSso = async () => (await db.query(
    'SELECT id, "redirectUri" FROM "redirectUri" WHERE "projectId" = $1 ORDER BY "redirectUri"', [ssoId])).rows;
  const [primeiraUriSso] = await urisDoSso();

  const editarUriSso = await api('PUT', `/redirecturi/${primeiraUriSso.id}`, { redirectUri: primeiraUriSso.redirectUri });
  check('redirect URI do SSO nao se edita, nem pela raiz', protegido(editarUriSso), detalhe(editarUriSso));

  const ORIGEM_TEMPORARIA = `http://localhost:${59000 + crypto.randomInt(900)}`;
  const uriTemporaria = await api('POST', '/redirecturi', { projectId: ssoId, redirectUri: `${ORIGEM_TEMPORARIA}/callback` });
  rodada.urisDoSso.push(uriTemporaria.json?.id);
  check('a raiz cadastra redirect URI nova no SSO', uriTemporaria.status === 201, `HTTP ${uriTemporaria.status}`);

  const gestorApagaUri = await adminReq('DELETE', `/redirecturi/${uriTemporaria.json?.id}`, gestorHeaders);
  check('papel de gestao nao apaga redirect URI do SSO', protegido(gestorApagaUri), detalhe(gestorApagaUri));

  const apagarAPropria = await adminReq('DELETE', `/redirecturi/${uriTemporaria.json?.id}`,
    { ...superHeaders, origin: ORIGEM_TEMPORARIA });
  check('ninguem apaga a redirect URI do SSO da origem de onde pede',
    apagarAPropria.status === 403 && apagarAPropria.json?.error === 'sso_redirect_uri_in_use', detalhe(apagarAPropria));

  const apagarTemporaria = await adminReq('DELETE', `/redirecturi/${uriTemporaria.json?.id}`, superHeaders);
  check('a raiz apaga redirect URI do SSO que nao e a ultima nem a de quem pede (204)',
    apagarTemporaria.status === 204, detalhe(apagarTemporaria));

  const restantes = await urisDoSso();
  if (restantes.length === 1) {
    const [unica] = restantes;
    const apagarUltima = await api('DELETE', `/redirecturi/${unica.id}`);
    if (apagarUltima.status < 300) {
      // A protecao falhou: devolve o endereco antes que o console perca o login.
      await db.query('INSERT INTO "redirectUri" (id, "projectId", "redirectUri") VALUES ($1, $2, $3)',
        [unica.id, ssoId, unica.redirectUri]);
    }
    check('a ultima redirect URI do SSO nao sai',
      apagarUltima.status === 403 && apagarUltima.json?.error === 'sso_redirect_uri_last', detalhe(apagarUltima));
  } else {
    console.log(`  --    | ultima redirect URI do SSO: nao testado, o projeto tem ${restantes.length}`);
  }

  // Desfaz no SSO o que so existia para as tentativas, por id e nome exatos.
  if (uriTemporaria.json?.id) {
    await db.query('DELETE FROM "redirectUri" WHERE id = $1', [uriTemporaria.json.id]);
  }
  await db.query('DELETE FROM "Route" WHERE "projectId" = $1 AND path = $2', [ssoId, CAMINHO_TENTATIVA]);
  await db.query('DELETE FROM "Role" WHERE "projectId" = $1 AND name = ANY($2)',
    [ssoId, [`E2E_TENTATIVA_${TAG}`, `E2E_TEMPORARIO_${TAG}`]]);

  console.log('\n=== tela de login do IdP: so abre com pedido pendente ===');

  const LOGIN_URL = env.SSO_LOGIN_URL;
  check('SSO_LOGIN_URL configurada', !!LOGIN_URL, LOGIN_URL ?? 'ausente em sso/.env.docker');

  /* Chamada crua, para ler o Set-Cookie, que `api()` descarta. */
  const bruto = async (method, rota, headers = {}, body) => {
    const res = await fetch(`${BASE}${rota}`, {
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

  /* Com COOKIE_SECURE ligado o nome ganha `__Host-`. A suite aceita os dois. */
  const cookieDe = (setCookies, base) => {
    const linha = setCookies.find((c) => c.startsWith(`${base}=`) || c.startsWith(`__Host-${base}=`));
    return linha ? linha.split(';')[0] : null;
  };

  const semSessao = await bruto('GET', authorizeQs());
  check('authorize sem sessao leva a tela de login do front, nao direto ao Google',
    semSessao.status === 302 && semSessao.location === LOGIN_URL,
    semSessao.location ?? `HTTP ${semSessao.status}`);

  const txCookie = cookieDe(semSessao.cookies, 'sso_tx');
  check('o pedido pendente fica no cookie de transacao', !!txCookie);

  const pedido = await bruto('GET', '/login/request', { cookie: txCookie });
  check('a tela de login le o pedido: qual aplicacao pediu',
    pedido.status === 200 && pedido.json?.kind === 'authorize' && pedido.json?.application === `krloc-${tag}`,
    `HTTP ${pedido.status} ${JSON.stringify(pedido.json)}`);
  check('o provedor Google aponta para o inicio da federacao no SSO',
    pedido.json?.providers?.[0]?.url === `${BASE}/oauth/google`,
    pedido.json?.providers?.[0]?.url ?? 'ausente');

  const semPedido = await bruto('GET', '/login/request');
  check('sem pedido pendente a tela de login nao oferece login (404)',
    semPedido.status === 404 && semPedido.json?.error === 'no_pending_request', `HTTP ${semPedido.status}`);

  const googleSemPedido = await bruto('GET', '/oauth/google');
  check('ir direto ao Google sem pedido volta a tela de login com o motivo',
    googleSemPedido.status === 302 && googleSemPedido.location === `${LOGIN_URL}?error=no_pending_request`,
    googleSemPedido.location ?? `HTTP ${googleSemPedido.status}`);

  const googleComPedido = await bruto('GET', '/oauth/google', { cookie: txCookie });
  const idaAoGoogle = googleComPedido.location ? new URL(googleComPedido.location) : null;
  check('com pedido pendente segue ao Google, com o nonce como state',
    googleComPedido.status === 302 && idaAoGoogle?.hostname === 'accounts.google.com'
      && (idaAoGoogle?.searchParams.get('state') ?? '').length > 0,
    idaAoGoogle ? `${idaAoGoogle.hostname}${idaAoGoogle.pathname}` : `HTTP ${googleComPedido.status}`);

  const callbackSemPedido = await bruto('GET', '/oauth/google/callback?code=x&state=y');
  check('callback do Google sem pedido volta a tela de login como expirado',
    callbackSemPedido.status === 302 && callbackSemPedido.location === `${LOGIN_URL}?error=request_expired`,
    callbackSemPedido.location ?? `HTTP ${callbackSemPedido.status}`);

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

  const redirectEstranho = await bruto('GET', sessionLoginQs({ redirect_uri: 'http://evil.example/callback' }));
  check('login do console com redirect_uri nao registrada NAO redireciona',
    redirectEstranho.status === 400 && !redirectEstranho.location && redirectEstranho.json?.error === 'invalid_request',
    `HTTP ${redirectEstranho.status}`);

  const stateFraco = await bruto('GET', sessionLoginQs({ state: 'curto' }));
  check('state fraco volta como erro pela redirect_uri do console',
    stateFraco.status === 302 && stateFraco.location?.startsWith(consoleRedirect)
      && new URL(stateFraco.location).searchParams.get('error') === 'invalid_request',
    stateFraco.location ?? `HTTP ${stateFraco.status}`);

  const consoleSemSessao = await bruto('GET', sessionLoginQs());
  check('o console sem sessao tambem passa pela tela de login',
    consoleSemSessao.status === 302 && consoleSemSessao.location === LOGIN_URL,
    consoleSemSessao.location ?? `HTTP ${consoleSemSessao.status}`);

  const pedidoDoConsole = await bruto('GET', '/login/request', {
    cookie: cookieDe(consoleSemSessao.cookies, 'sso_tx'),
  });
  check('a tela de login sabe que o pedido e do console',
    pedidoDoConsole.json?.kind === 'session' && pedidoDoConsole.json?.application === 'SSO',
    JSON.stringify(pedidoDoConsole.json));

  // Sessao do operador com token anti-CSRF, como a que o callback do Google cria.
  const operadorId = (await db.query('SELECT id FROM "User" WHERE email = $1', [OPERADOR])).rows[0].id;
  const sessaoDoOperador = crypto.randomUUID();
  await db.query(
    `INSERT INTO "AuthSession" (id, "userId", "expiresAt")
     VALUES ($1, $2, (now() AT TIME ZONE 'utc') + interval '1 hour')`,
    [sessaoDoOperador, operadorId],
  );
  const CSRF = crypto.randomBytes(32).toString('base64url');
  const cookieDoOperador = `sso_session=${sealCookie({ authSessionId: sessaoDoOperador, csrf: CSRF })}`;
  const origemDoConsole = new URL(consoleRedirect).origin;

  const consoleComSessao = await bruto('GET', sessionLoginQs(), { cookie: cookieDoOperador });
  const voltaAoConsole = consoleComSessao.location ? new URL(consoleComSessao.location) : null;
  check('com sessao viva o console volta direto, com o state e sem code',
    consoleComSessao.status === 302
      && `${voltaAoConsole?.origin}${voltaAoConsole?.pathname}` === consoleRedirect
      && voltaAoConsole?.searchParams.get('state') === consoleState
      && !voltaAoConsole?.searchParams.has('code')
      && !voltaAoConsole?.searchParams.has('error'),
    consoleComSessao.location ?? `HTTP ${consoleComSessao.status}`);

  const semPapelNoSso = await bruto('GET', sessionLoginQs(), { cookie: sessionCookie });
  check('quem nao tem papel no SSO volta ao console com access_denied',
    semPapelNoSso.status === 302 && new URL(semPapelNoSso.location).searchParams.get('error') === 'access_denied',
    semPapelNoSso.location ?? `HTTP ${semPapelNoSso.status}`);

  const leituraPorSessao = await bruto('GET', '/project', { cookie: cookieDoOperador });
  check('a API administrativa aceita a sessao do console', leituraPorSessao.status === 200,
    `HTTP ${leituraPorSessao.status}`);

  const mePorSessao = await bruto('GET', '/me', { cookie: cookieDoOperador });
  check('GET /me pela sessao devolve o token anti-CSRF',
    mePorSessao.status === 200 && mePorSessao.json?.csrfToken === CSRF, `HTTP ${mePorSessao.status}`);
  check('GET /me por Bearer nao devolve token anti-CSRF', me.json?.csrfToken === undefined);

  const emailPorSessao = `sessao-${tag}@exemplo.com`;
  rodada.usuarios.push(emailPorSessao);
  const novoUsuario = { name: 'Criado pela sessao', email: emailPorSessao };

  const escritaSemToken = await bruto('POST', '/user', { cookie: cookieDoOperador }, novoUsuario);
  check('escrita pela sessao sem X-CSRF-Token e recusada',
    escritaSemToken.status === 403 && escritaSemToken.json?.error === 'csrf_token_invalid',
    `HTTP ${escritaSemToken.status}`);

  const escritaDeOutraOrigem = await bruto('POST', '/user',
    { cookie: cookieDoOperador, 'x-csrf-token': CSRF, origin: 'http://evil.example' }, novoUsuario);
  check('token certo vindo de outra origem continua recusado',
    escritaDeOutraOrigem.status === 403 && escritaDeOutraOrigem.json?.error === 'origin_not_allowed',
    `HTTP ${escritaDeOutraOrigem.status}`);
  check('a recusa de origem nao repete a origem recebida',
    !JSON.stringify(escritaDeOutraOrigem.json).includes('evil.example'),
    String(escritaDeOutraOrigem.json?.message));

  const escritaValida = await bruto('POST', '/user',
    { cookie: cookieDoOperador, 'x-csrf-token': CSRF, origin: origemDoConsole }, novoUsuario);
  check('escrita pela sessao com token e origem do console passa', escritaValida.status === 201,
    `HTTP ${escritaValida.status}`);

  const cookieSemToken = `sso_session=${sealCookie({ authSessionId: sessaoDoOperador })}`;
  const meSemToken = await bruto('GET', '/me', { cookie: cookieSemToken });
  check('sessao criada antes da defesa ganha token na primeira chamada',
    meSemToken.status === 200 && typeof meSemToken.json?.csrfToken === 'string'
      && !!cookieDe(meSemToken.cookies, 'sso_session'),
    `HTTP ${meSemToken.status}`);

  const sessaoAnonima = await bruto('GET', '/session');
  check('GET /session sem cookie responde sessao inativa',
    sessaoAnonima.status === 200 && sessaoAnonima.json?.active === false, `HTTP ${sessaoAnonima.status}`);

  const sessaoAtiva = await bruto('GET', '/session', { cookie: cookieDoOperador });
  check('GET /session com sessao devolve quem e e o token anti-CSRF',
    sessaoAtiva.json?.active === true && sessaoAtiva.json?.csrfToken === CSRF
      && sessaoAtiva.json?.user?.email === OPERADOR,
    JSON.stringify(sessaoAtiva.json?.user ?? null));

  const sessaoSemPapel = await bruto('GET', '/session', { cookie: sessionCookie });
  check('quem nao tem papel no console tambem recebe o token, para conseguir sair',
    sessaoSemPapel.json?.active === true && typeof sessaoSemPapel.json?.csrfToken === 'string',
    `HTTP ${sessaoSemPapel.status}`);

  const sairSemToken = await bruto('POST', '/session/logout', { cookie: cookieDoOperador });
  check('logout do console sem token anti-CSRF e recusado', sairSemToken.status === 403,
    `HTTP ${sairSemToken.status}`);

  const sair = await bruto('POST', '/session/logout', { cookie: cookieDoOperador, 'x-csrf-token': CSRF });
  check('logout do console com o token encerra a sessao', sair.status === 204, `HTTP ${sair.status}`);

  const depoisDeSair = await bruto('GET', '/project', { cookie: cookieDoOperador });
  check('depois do logout a mesma sessao nao abre mais nada', depoisDeSair.status === 401,
    `HTTP ${depoisDeSair.status}`);

  /* A suite roda contra o banco de desenvolvimento de verdade. Sem esta
   * limpeza, cada rodada deixava projeto orfao, usuarios com papel no proprio
   * SSO, e papeis e rotas de teste no catalogo dele. */
  const limpo = await limparRodada();

  console.log(
    `\nlimpeza: ${limpo.projetos} projeto(s), ${limpo.usuarios} usuario(s), ` +
      `${rodada.papeisDoSso.length} papel(eis) e ${rodada.rotasDoSso.length} rota(s) de teste removidos`,
  );

  await db.end();
  console.log(`\n=========== ${pass} passaram, ${fail} falharam ===========\n`);
  process.exit(fail ? 1 : 0);
})().catch(async (e) => {
  console.error('ERRO:', e);
  await limparRodada().catch((falha) => console.error('a limpeza tambem falhou:', falha.message));
  await db.end().catch(() => {});
  process.exit(1);
});
