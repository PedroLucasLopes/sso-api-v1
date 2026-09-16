# Arquitetura OAuth 2.0 + PKCE

Diagramas no estilo da RFC 6749. Refletem o que o código faz hoje, não um alvo futuro.

Papéis, no vocabulário das RFCs:

| Peça | Papel OAuth | Onde mora |
|---|---|---|
| Navegador | user-agent | máquina do usuário |
| `krloc` + `@pedrolucaslopes/sso-client` | client confidencial, token-mediating backend (RFC 10017 §6.2) | `krloc/` |
| `sso` | authorization server | `sso/` |
| Google | identity provider federado | externo |
| Postgres do SSO | store de code, refresh token e sessão | container |

---

## 1. Visão em camadas

Padrão **token-mediating backend** (RFC 10017 §6.2). A aplicação é um backend registrado no SSO,
cliente confidencial, que conduz o fluxo e depois **entrega o access token** a quem tem a sessão.

A linha que separa o que sai do que fica: **o access token sai, o refresh token não** (§6.2.2.2).

```
                       o que atravessa
                             |
   +---------------+         |         +-----------------------------+
   |               |         |         |   CAMADA DA APLICACAO       |
   |   CLIENTE     |         |         |   krloc                     |
   |  (front, CLI, |         |         |                             |
   |   outro app)  | access  |         |  @pedrolucaslopes/sso-client         |
   |               | token   |         |   . SsoRbacGuard (global)   |
   |  Authorization+<--------|---------+   . GET /auth/token         |
   |  Bearer <tok> |         |         |                             |
   |               | cookie  |         |   FICA AQUI:                |
   |  app_session  +<--------|-------->+   . refresh token           |
   |  (so sessao)  |         |         |   . chave privada do client |
   +---------------+         |         +--------------+--------------+
                             |                        |
                             |                        | servidor a servidor
                             |                        | private_key_jwt
                             |                        v
                             |         +-----------------------------+
                             |         |   CAMADA DO SSO             |
                             |         |   Authorization Server      |
                             |         |                             |
                             |         |   /oauth/authorize          |
        redirects do usuario |         |   /oauth/token              |
        ---------------------|-------->|   /oauth/revoke             |
                             |         |   /.well-known/jwks.json    |
                             |         +--------------+--------------+
                             |                        |
                             |                        v
                             |         +-----------------------------+
                             |         |  Postgres  . AuthorizationCode
                             |         |            . RefreshToken   |
                             |         |            . AuthSession    |
                             |         |            . SigningKey     |
                             |         +-----------------------------+
```

O que isso custa, e a RFC diz na cara (§6.2.4): com o access token fora do servidor, quem roubar o
token tem acesso direto aos recursos pelo tempo de vida dele. É por isso que ele dura 15 minutos e
que o refresh token, que dura 14 dias, fica para trás.

### Depois do login: pegando o token

```
 +----------+                          +--------------+          +-------------+
 | CLIENTE  |                          |  APLICACAO   |          |     SSO     |
 +----+-----+                          +------+-------+          +------+------+
      |                                       |                         |
      | GET /api/auth/token                   |                         |
      | Cookie: app_session                   |                         |
      |-------------------------------------->|                         |
      |                                       | expira em < 60s?        |
      |                                       | sim: renova ----------->|
      |                                       |     grant_type=refresh  |
      |                                       |<------------------------|
      |                                       |                         |
      |  200 Cache-Control: no-store          |                         |
      |  {access_token, token_type: "Bearer", |                         |
      |   expires_in: 900}                    |                         |
      |  (sem refresh_token, de proposito)    |                         |
      |<--------------------------------------|                         |
      |                                       |                         |
      | GET /api/equipment                    |                         |
      | Authorization: Bearer <access_token>  |                         |
      |-------------------------------------->|                         |
      |                                       | verifica contra o JWKS  |
      |                                       | casa a permissao        |
      |<--------------------------------------| 200                     |
      |                                       |                         |
      | quando expirar, volta ao /auth/token  |                         |
```

---

## 2. Login completo

O caminho longo: usuário sem sessão no SSO, precisando passar pelo Google.

```
 +----------+          +--------------+          +-------------+       +--------+
 |          |          |  APLICACAO   |          |     SSO     |       | Google |
 |Navegador |          |    krloc     |          | Auth Server |       |  IdP   |
 +----+-----+          +------+-------+          +------+------+       +---+----+
      |                       |                         |                  |
      | (A) GET /api/equipment|                         |                  |
      |---------------------->|                         |                  |
      |                       | guard: sem sessao       |                  |
      |<----------------------| 401                     |                  |
      |                       |                         |                  |
      | (B) GET /api/auth/login                         |                  |
      |---------------------->|                         |                  |
      |                       | gera code_verifier (32B)|                  |
      |                       | challenge = S256(v)     |                  |
      |                       | state (32B)             |                  |
      |    Set-Cookie app_tx  |                         |                  |
      |    {state, verifier}  |                         |                  |
      |<----------------------| 302                     |                  |
      |                       |                         |                  |
      | (C) GET /sso/oauth/authorize                    |                  |
      |     ?client_id &redirect_uri &response_type=code|                  |
      |     &code_challenge &code_challenge_method=S256 &state             |
      |------------------------------------------------>|                  |
      |                       |         valida, nesta ordem:               |
      |                       |          1. client_id existe               |
      |                       |          2. Project.status = ACTIVE        |
      |                       |          3. redirect_uri exata na lista    |
      |                       |          -- daqui, erro volta pela uri --  |
      |                       |          4. state, response_type, S256     |
      |                       |          5. formato do code_challenge      |
      |                       |                         |                  |
      |                       |         sem sso_session:|                  |
      |    Set-Cookie sso_tx  |         grava transacao |                  |
      |    {challenge, state, |         + googleNonce   |                  |
      |     googleNonce, ...} |                         |                  |
      |<------------------------------------------------| 302 SSO_LOGIN_URL|
      |                       |                         |                  |
      | (C') GET /login: a tela de login do IdP, no front do SSO           |
      |      GET /sso/login/request -> aplicacao e provedores              |
      |      a pessoa escolhe "Continue with Google"    |                  |
      |                       |                         |                  |
      | (D) GET /sso/oauth/google                       |                  |
      |------------------------------------------------>|                  |
      |                       |         state=googleNonce                  |
      |<------------------------------------------------| 302 ------------>|
      |                       |                         |                  |
      | (E) consentimento do usuario                    |                  |
      |------------------------------------------------------------------>|
      |<------------------------------------------------------------------|
      |                       |                         |                  |
      | (F) GET /sso/oauth/google/callback ?code &state |                  |
      |------------------------------------------------>|                  |
      |                       |         GoogleStrategy: |                  |
      |                       |          . exige email_verified            |
      |                       |          . User precisa existir (sem       |
      |                       |            auto-cadastro)                  |
      |                       |          . confere authId                  |
      |                       |         confere state == googleNonce       |
      |                       |         cria AuthSession -----> [Postgres] |
      |                       |         confere ProjectUser                |
      |                       |         code = 32B; grava SHA-256          |
      |                       |         em AuthorizationCode (TTL 60s)     |
      | Set-Cookie sso_session|                         |                  |
      |<------------------------------------------------| 302              |
      |                       |                         |                  |
      | (G) GET /api/auth/callback ?code &state &iss    |                  |
      |---------------------->|                         |                  |
      |                       | le app_tx e apaga       |                  |
      |                       | confere iss  (RFC 9207) |                  |
      |                       | confere state (timing-safe)                |
      |                       |                         |                  |
      |                       | (H) POST /sso/oauth/token                  |
      |                       |     grant_type=authorization_code          |
      |                       |     code, code_verifier, redirect_uri      |
      |                       |     client_assertion (JWT RS256)           |
      |                       |------------------------>|                  |
      |                       |                         |                  |
      |                       |     1. autentica o cliente:                |
      |                       |        assinatura da assercao contra a     |
      |                       |        ClientKey publica do Project        |
      |                       |     2. Project.status = ACTIVE             |
      |                       |     3. consome o code ATOMICAMENTE         |
      |                       |        UPDATE .. WHERE consumedAt IS NULL  |
      |                       |     4. SHA256(verifier) == challenge       |
      |                       |     5. redirect_uri identica               |
      |                       |     6. le ProjectUser -> Role ->           |
      |                       |        Permission -> Route                 |
      |                       |     7. assina access token RS256 (kid)     |
      |                       |     8. emite refresh token (familia nova)  |
      |                       |                         |                  |
      |                       |  200 Cache-Control: no-store               |
      |                       |  {access_token, token_type,                |
      |                       |   expires_in: 900, refresh_token}          |
      |                       |<------------------------|                  |
      |                       |                         |                  |
      | Set-Cookie app_session|  cifra os dois tokens   |                  |
      |  (cifrado, HttpOnly)  |  num cookie so          |                  |
      |<----------------------| 302 -> /api/home        |                  |
      |                       |                         |                  |
      | (I) o usuario esta no front, autenticado        |                  |
      |                       |                         |                  |
```

### Por que o `iss` no passo (G)

RFC 9207. Diz ao cliente **qual** servidor respondeu. Sem isso, um cliente que fala com mais de um
authorization server fica exposto a mix-up: o atacante devolve um code emitido por outro servidor.

### Por que o `googleNonce` no passo (D)

O trecho SSO para Google é, ele próprio, um fluxo OAuth, e precisa da própria proteção de CSRF.
Sem o nonce, um atacante injetaria o próprio authorization code do Google no callback da vítima e a
faria entrar como ele. O cookie de transação sozinho não cobre isso, porque não amarra a uma
requisição específica ao provedor.

---

## 3. Requisição autenticada

O caminho curto. É o que acontece em quase toda requisição.

```
 +----------+          +-------------------------------+       +-------------+
 |Navegador |          |          APLICACAO            |       |     SSO     |
 +----+-----+          +---------------+---------------+       +------+------+
      |                                |                              |
      | GET /api/equipment             |                              |
      | Cookie: app_session            |                              |
      |------------------------------->|                              |
      |                                |                              |
      |                     +----------v-----------+                  |
      |                     |   SsoRbacGuard       |                  |
      |                     +----------+-----------+                  |
      |                                |                              |
      |                     0. tem Authorization: Bearer?             |
      |                        sim -> usa ele e pula ao passo 3       |
      |                                |                              |
      |                     1. decifra o cookie                       |
      |                        sem cookie e sem Bearer -> 401         |
      |                                |                              |
      |                     2. expira em < 60s?                       |
      |                        sim ---------------------------------->|
      |                             POST /oauth/token                 |
      |                             grant_type=refresh_token          |
      |                             + client_assertion                |
      |                        <-----------------------------------   |
      |                             novo par; reescreve o cookie      |
      |                                |                              |
      |                     3. verifica o access token                |
      |                        contra o JWKS -------------------->    |
      |                             GET /.well-known/jwks.json        |
      |                             (uma vez, cacheado por kid)       |
      |                        . allowlist RS256, nunca o alg do token|
      |                        . iss == issuer                        |
      |                        . aud == clientId                      |
      |                        . exp > agora                          |
      |                                |                              |
      |                     4. veio do cookie? preenche o header      |
      |                        Authorization: Bearer <token>          |
      |                        (so DEPOIS de verificar)               |
      |                                |                              |
      |                     5. RBAC: casa metodo + caminho            |
      |                        contra claims.permissions[]            |
      |                                |                              |
      |                        quem vira regex e a PERMISSAO.         |
      |                        o caminho da requisicao e sempre       |
      |                        so o texto testado.                    |
      |                                |                              |
      |                     +----------v-----------+                  |
      |                     |  handler do dominio  |                  |
      |                     +----------+-----------+                  |
      |<-------------------------------| 200                          |
      |                                |                              |
      |                        sem permissao -> 403                   |
```

---

## 4. Segundo app: o "single" do single sign-on

Com `sso_session` viva, o passo do Google desaparece por completo.

```
 +----------+          +--------------+          +-------------+       +--------+
 |Navegador |          |   OUTRO APP  |          |     SSO     |       | Google |
 +----+-----+          +------+-------+          +------+------+       +---+----+
      |                       |                         |                  |
      | GET /api2/auth/login  |                         |                  |
      |---------------------->|                         |                  |
      |<----------------------| 302                     |                  |
      |                       |                         |                  |
      | GET /sso/oauth/authorize ... &state             |                  |
      | Cookie: sso_session   |                         |                  |
      |------------------------------------------------>|                  |
      |                       |         sessao valida:  |                  |
      |                       |         emite o code direto                |
      |                       |                         |     (nao passa)  |
      |<------------------------------------------------| 302              |
      |                       |                         |                  |
      | GET /api2/auth/callback ?code &state &iss       |                  |
      |---------------------->|                         |                  |
      |                       | POST /oauth/token ----->|                  |
      |                       |<------------------------|                  |
      |<----------------------| 302 -> /api2/home       |                  |
```

O RBAC continua por projeto: o mesmo usuário entra nos dois, mas com as permissões de cada um.
Sem `ProjectUser` no segundo projeto, o SSO devolve `access_denied` pela `redirect_uri`.

---

## 5. Logout e revogação

```
 +----------+          +--------------+          +-------------+
 |Navegador |          |  APLICACAO   |          |     SSO     |
 +----+-----+          +------+-------+          +------+------+
      |                       |                         |
      | POST /api/auth/logout |                         |
      |---------------------->|                         |
      |                       | 1. le o refresh token   |
      |                       |    do cookie            |
      |                       | 2. limpa os cookies     |
      |                       |    (primeiro: se a rede |
      |                       |     cair, o usuario     |
      |                       |     sai localmente)     |
      |                       |                         |
      |                       | 3. POST /oauth/revoke   |
      |                       |    token=<refresh>      |
      |                       |    + client_assertion   |
      |                       |------------------------>|
      |                       |                         | revoga a FAMILIA
      |                       |                         | inteira, nao so o
      |                       |                         | token apresentado
      |                       |  200 (sempre, mesmo para|
      |                       |  token desconhecido)    |
      |                       |<------------------------|
      | 204                   |                         |
      |<----------------------|                         |
```

Limpar o cookie sozinho seria cosmético: com sessão client-side, qualquer outra cópia do cookie
continuaria renovando para sempre. O access token já emitido segue válido até expirar, o que é
inerente a token assinado e sem consulta. É por isso que ele dura 15 minutos.

O 200 para token desconhecido é deliberado (RFC 7009 §2.2): responder 404 transformaria o endpoint
num oráculo sobre quais tokens existem.

---

## 6. O que cada rota manda para onde

### Camada da aplicação, instalada pela biblioteca

| Rota | Recebe | Manda para | Devolve |
|---|---|---|---|
| `GET /api/auth/login` | nada | navegador | `Set-Cookie app_tx` + 302 para o authorize |
| `GET /api/auth/callback` | `code`, `state`, `iss` | **SSO**, servidor a servidor | `Set-Cookie app_session` + 302 para o app |
| `GET /api/auth/token` | cookie | **SSO**, só se precisar renovar | `access_token`, `expires_in`, sem refresh |
| `POST /api/auth/logout` | cookie | **SSO** `/oauth/revoke` | 204, cookies apagados |
| `GET /api/auth/me` | cookie ou Bearer | nada | identidade e permissões |
| _qualquer outra_ | cookie ou Bearer | JWKS do SSO, se preciso | 200, 401 ou 403 |

### Camada do SSO

| Rota | Recebe | Consulta | Devolve |
|---|---|---|---|
| `GET /oauth/authorize` | query do cliente | `Project`, `redirectUri`, `AuthSession`, `ProjectUser` | 302 com `code`, `state`, `iss` |
| `GET /oauth/google` | cookie de transação | — | 302 para o Google, com nonce |
| `GET /oauth/google/callback` | `code` e `state` do Google | `User`, cria `AuthSession` e `AuthorizationCode` | 302 para a `redirect_uri` |
| `POST /oauth/token` | grant + `client_assertion` | `ClientKey`, `AuthorizationCode`, `RefreshToken`, `SigningKey`, RBAC | JSON com os dois tokens |
| `POST /oauth/revoke` | token + `client_assertion` | `RefreshToken` | 200 sempre |
| `GET /.well-known/jwks.json` | nada | `SigningKey` | chaves públicas |
| `GET /.well-known/oauth-authorization-server` | nada | — | metadados (RFC 8414) |

---

## 7. Onde cada segredo vive

```
   APLICACAO                         SSO                        NAVEGADOR
   ---------                         ---                        ---------
   chave privada do cliente   <-->   ClientKey (so a publica)
   (assina a assercao)               verifica a assercao

                                     SigningKey privada
                                     (cifrada com a KEK)
                                            |
                                            | assina
                                            v
   verifica com o JWKS        <----    access token RS256
   (so a chave publica)                                          nunca ve

   COOKIE_SECRET                      COOKIE_SECRET              cookie opaco
   (cifra a sessao,                   (cifra sso_session)        (nao decifra)
    onde mora o refresh)
```

A propriedade que sustenta o desenho: **a aplicação verifica, mas não consegue emitir**. Antes, com
HS256 e segredo compartilhado, quem verificava também assinava, e qualquer aplicação podia forjar
token para qualquer outra.

E o corte entre as colunas: o **access token** atravessa para o cliente, o **refresh token** e a
**chave privada** não. É o que separa o token-mediating backend de entregar tudo ao navegador.

---

## 8. O portão que vem antes de tudo

Nenhum desses fluxos começa se o projeto não tiver sido autorizado dentro do SSO.

```
   POST /project           -> Project criado com status = PENDING
                              (existe, mas nao usa o SSO)
        |
        v
   POST /clientkey/generate   exige Bearer de um SUPERADMIN
        |                     o SSO gera o par, guarda so a publica,
        |                     devolve a privada UMA VEZ
        v
   POST /projectuser       -> quem tem acesso, com qual papel
        |
        v
   PATCH /project/:id/status { ACTIVE }   <- a autorizacao nasce AQUI
        |
        v
   agora /authorize e /token aceitam este client_id
```

Suspender devolve o projeto para fora: `/authorize` e o token endpoint passam a recusar, e a
renovação por refresh token para junto.

Conferência num lugar só: `GET /project/:id/overview` mostra identidade, credencial, rotas, papéis
e quem tem acesso a quê.

---

## 9. O SSO é um projeto de si mesmo

As rotas administrativas do SSO passam pelo mesmo portão que as das aplicações clientes. Não há
segredo de administração em variável de ambiente.

```
   Console                         SSO                      Postgres
      |                             |                           |
      |-- OAuth + PKCE ------------>|                           |
      |<-- access token ------------|   aud = clientId do        |
      |    (aud = projeto SSO)      |   projeto chamado "SSO"    |
      |                             |                           |
      |-- GET /sso/project -------->|                           |
      |   Authorization: Bearer     |-- verifica assinatura --->|  SigningKey[kid]
      |                             |-- confere aud ----------->|  Project.clientId
      |                             |-- le o papel AGORA ------>|  ProjectUser -> Role
      |                             |-- casa metodo e caminho ->|  Permission -> Route
      |<-- 200 ou 404 --------------|                           |
```

O papel é relido a cada requisição, e não tirado da claim `roles` do token. Apagar a linha de
`ProjectUser` derruba o acesso na hora, sem esperar os 15 minutos do access token.

O `SUPERADMIN` do projeto `SSO` é a raiz: passa sem consultar `Permission`. Os outros papéis, sem
permissão para a rota, recebem 404, como caminho que não existe. A primeira raiz de cada ambiente nasce
de um SQL rodado uma vez, fora de todo repositório. Conceder o primeiro papel é ele próprio uma ação
administrativa, e esse é o único jeito de quebrar o ciclo sem enfraquecer nada: quem tem a senha do
Postgres já podia tudo.

---

## 10. A tela de login e o console do SSO

A tela de login do IdP mora no front do SSO e só oferece provedor com um pedido pendente. O console
entra por ela como qualquer aplicação, mas não troca code: depois do login ele usa a sessão do
próprio SSO, na mesma origem da API.

```
 +----------+             +-----------------+                +-------------+
 |Navegador |             | Console (front) |                |     SSO     |
 +----+-----+             +--------+--------+                +------+------+
      |                            |                                |
      | GET /projects              |                                |
      |--------------------------->| guard: GET /sso/me             |
      |                            |------------------------------->|
      |                            |<-------------------------------| 401
      |                            | gera state, guarda na aba      |
      |<---------------------------| navega                         |
      |                            |                                |
      | GET /sso/session/login ?redirect_uri=<origem>/callback &state
      |------------------------------------------------------------>|
      |                            |   redirect_uri exata no projeto SSO
      |                            |   sem sessao: Set-Cookie sso_tx
      |<------------------------------------------------------------| 302 /login
      |                            |                                |
      | GET /login, GET /sso/login/request, "Continue with Google"  |
      | ... Google, callback, AuthSession                           |
      | Set-Cookie sso_session {authSessionId, csrf}                |
      |<------------------------------------------------------------| 302 /callback ?state &iss
      |                            |                                |
      | GET /callback              |                                |
      |--------------------------->| confere o state da aba         |
      |                            | GET /sso/me, pelo cookie       |
      |                            |------------------------------->|
      |                            |<-------------------------------| 200 papel, permissoes, csrfToken
      |<---------------------------| volta para /projects           |
      |                            |                                |
      | POST /sso/project   Cookie + X-CSRF-Token + Origin do console
      |------------------------------------------------------------>| sessao, CSRF, origem, Permission
```

Por que sessão e não token: front e API na mesma origem são o caso da RFC 10017 §7.1. Nenhum token
chega ao JavaScript, e logout ou revogação da sessão valem na hora. A autorização continua a mesma
da seção 9: `ProjectUser`, `Role` e `Permission`, relidos a cada pedido.
