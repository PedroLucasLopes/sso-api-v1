# 🔐 SSO — Authorization Server (OAuth 2.0 + PKCE)

Servidor de identidade e autorização central do ecossistema.
É o **Authorization Server** (AS) do fluxo OAuth 2.0 Authorization Code + PKCE e, ao mesmo tempo,
o **catálogo RBAC** de todos os projetos que se conectam a ele.

O login do usuário final é **federado ao Google** (o SSO é, por sua vez, um cliente OAuth do Google),
mas quem emite o `access_token` consumido pelas aplicações é este serviço.

| Repositório | Papel |
|---|---|
| `sso-api-v1` (este) | Authorization Server + CRUD RBAC |
| [`plataforma_sso-v1`](https://github.com/PedroLucasLopes/plataforma_sso-v1) | tela de login do IdP e console administrativo (Vue/Vuetify) |
| [`krloc-api-v1`](https://github.com/PedroLucasLopes/krloc-api-v1) | Relying Party — API de locação de equipamentos |
| [`plataforma_krloc-v1`](https://github.com/PedroLucasLopes/plataforma_krloc-v1) | front da locação de equipamentos (Vue/Vuetify) |
| [`sso-lib-v1`](https://github.com/PedroLucasLopes/sso-lib-v1) | `@pedrolucaslopes/sso-client`, a autenticação das APIs |
| [`components_storybook-v1`](https://github.com/PedroLucasLopes/components_storybook-v1) | `@pedrolucaslopes/dotlog-ui`, componentes e Storybook |

Cada um é um repositório independente, com infraestrutura e deploy próprios. As regras do ecossistema,
o ambiente local e o cadastro de aplicações estão em [`docs/ecossistema.md`](docs/ecossistema.md); os
diagramas do fluxo, em [`docs/arquitetura-oauth.md`](docs/arquitetura-oauth.md).

---

## ⚡ Stack

- **NestJS 11** (Express) · TypeScript 5.7 · CommonJS
- **Prisma 7** com `prisma-client` generator → `generated/prisma` (adapter `@prisma/adapter-pg`)
- **PostgreSQL** como único store. **Não há Redis.**
- **Passport** + `passport-google-oauth20` para o leg de federação com o Google
- **@nestjs/jwt** para assinar em RS256 com chave por requisição
- `class-validator` + `class-transformer` nos DTOs

---

## 🏃 Comandos

```bash
npm run start:dev        # nest start --watch
npm run build            # nest build
npm run lint             # eslint --fix
npm run test:oauth       # teste ponta a ponta do fluxo OAuth (exige a stack de pé)
npx prisma migrate dev
npx prisma generate
```

Porta padrão: `PORT` ou **8080**. Prefixo global: **`/sso`**.

Em container, `docker compose up -d --build` na raiz deste repositório, com a configuração em
`.env.docker`. O compose sobe só o SSO e as migrations. Cada aplicação sobe o próprio compose, no
próprio repositório, e chega a este serviço pela porta da máquina, `host.docker.internal:8080`.

`npm run test:oauth` sobe 174 asserções contra o servidor rodando: ordem dos erros do authorize,
formato dos erros do token endpoint, PKCE, autenticação de cliente, verificação do access token
contra o JWKS, uso único do code, rotação de refresh token, revogação pelos dois tipos de token, a
autorização administrativa vinda do banco, a raiz e o 404 de rota negada, papéis de nome livre, troca
e remoção de membro, a tela de login do IdP, o login do console e a escrita pela sessão com CSRF, a
exclusão de redirect URI, a proteção do projeto SSO, a exclusão de conta sem projeto, a
introspecção e o contrato de erro por código. **Rode depois de qualquer mudança em
`routes/auth/` ou em `global/access/`.**

`npx jest` roda os testes de unidade. Hoje cobrem a proteção do projeto SSO, inclusive a regra do
último SUPERADMIN, que a suíte ponta a ponta não alcança sem rebaixar a raiz real do ambiente, e os
filtros do Prisma, que não podem deixar o texto dele chegar ao corpo da resposta.

A suíte ponta a ponta **só roda contra banco local** e recusa outro endereço antes de gravar qualquer
coisa: ela cria operadores com papel no próprio SSO, papéis e rotas, e desfaz tudo no fim, inclusive
quando quebra no meio. Precisa do SQL de primeira subida aplicado e de mais nenhum dado pré-carregado.

---

## 🚀 CI/CD

`.github/workflows/ci.yml`, no GitHub Actions:

| Quando | O que roda |
|---|---|
| pull request e push na `main` | `npm ci`, `npm audit` (produção sem aviso nenhum; o resto, sem alto), `prisma generate`, `lint:check`, build e testes de unidade |
| pull request | a imagem é montada, sem publicar |
| push na `main`, tag `v*` e à mão | as imagens do SSO e da migration vão para o GitHub Container Registry, `ghcr.io/pedrolucaslopes/sso-api-v1` e `…-migrate`, com a tag do commit, `main` e a versão, proveniência e SBOM |

- **`lint:check` é o lint sem `--fix`.** O `lint` do modelo do Nest corrige sozinho, e no pipeline isso
  esconderia o erro em vez de recusar.
- **O teste do fluxo OAuth fica na máquina.** `npm run test:oauth` precisa do SSO de pé, com banco.
- **O pipeline é superfície de ataque.** Actions fixadas por commit, `permissions: {}` no topo e o
  mínimo por job, checkout sem credencial persistida, sem `pull_request_target`. O Dependabot
  (`.github/dependabot.yml`) abre pull request para as actions, o npm e a imagem base toda semana.
- **O deploy no GCP ainda não existe.** A imagem publicada é o artefato. Subir para o Cloud Run entra
  quando houver o projeto no GCP e a federação de identidade das Actions, sem chave de conta de serviço
  guardada em secret.

---

## 📁 Estrutura

```bash
💻 src/
├─ 🧩 global/
│  ├─ access/        # ⭐ AdminAccessService (quem pode agir), AdminRoutesService (as rotas da raiz) e a proteção do projeto SSO
│  ├─ constants/     # metadata dos guards, nome do projeto do SSO, prefixo global
│  ├─ cookie/        # CookieService: cookies cifrados (AES-256-GCM)
│  ├─ crypto/        # aead.ts (primitiva) + KeyEncryptionService
│  ├─ decorator/     # @Public() @Authenticated() @CurrentAdmin()
│  ├─ error/         # contrato de erro (apiError.ts), recusa da validação e filtros do Prisma
│  ├─ guards/        # SSOAdminGuard (APP_GUARD), GoogleAuthGuard
│  ├─ pagination/
│  └─ prisma/
├─ 🔐 routes/
│  ├─ auth/          # ⭐ fluxo OAuth
│  │  ├─ Controller/ Service/ dto/ error/ strategy/ auth.constant.ts
│  ├─ Key/           # chaves de assinatura, JWKS, discovery, chaves de cliente
│  ├─ Me/            # GET /sso/me: identidade e permissões de quem chamou
│  ├─ User/  Project/  Route/  Role/  Permission/  ProjectUser/  redirectUri/
│  └─ …              # cada um: Controller/ · Service/ · dto/ · *.module.ts
🧪 test/
├─ oauth-e2e.js      # a suíte ponta a ponta, só contra banco local
└─ lib/              # operatorToken.js (token pelo fluxo OAuth real) · cleanup.js
```

**Convenção deste projeto:** `routes/<Dominio>/{Controller,Service,dto}` com a **primeira letra
maiúscula** nas subpastas. (⚠️ o `krloc` usa minúsculas — divergência histórica, não unifique sem combinar.)

---

## 🗄️ Modelo de dados

```
User ──< ProjectUser >── Project ──< Route ──< Permission >── Role
     └──< AuthSession           ├──< redirectUri
             └──< RefreshToken  └──< ClientKey
```

| Model | Notas |
|---|---|
| `User` | `email` único; `authId` = id do Google, fixado no 1º login e conferido nos seguintes |
| `Project` | uma aplicação cliente; `clientId` único de 32 bytes hex. **O próprio SSO é um deles**, de nome `SSO` |
| `redirectUri` | lista branca de callbacks por projeto, único por `(projectId, redirectUri)` |
| `Route` | `path` + `method` + `projectId`, único em conjunto |
| `Role` | nome livre (maiúsculas, dígitos e `_`), único por `(name, projectId)`. Todo projeto nasce com SUPERADMIN, ADMIN, MANAGER e VIEWER, vazios |
| `Permission` | join `Role` × `Route` |
| `ProjectUser` | PK composta `(userId, projectId)` — um papel por usuário por projeto |
| `SigningKey` | chaves RS256 do AS. `id` é o `kid` do JWKS. Privada cifrada com `KEY_ENCRYPTION_KEY` |
| `ClientKey` | chave pública do RP para `private_key_jwt`. Substitui o `clientSecret` removido |
| `AuthSession` | sessão do usuário com o SSO. Âncora de revogação e do single sign-on |
| `AuthorizationCode` | guardado como hash, consumido atomicamente |
| `RefreshToken` | rotação obrigatória; `familyId` agrupa a cadeia para detecção de reuso |

### Por que cada estado mora onde mora

| Estado | Onde | Por quê |
|---|---|---|
| Transação de autorização | cookie cifrado | vive no navegador durante os redirects; amarra o fluxo ao user-agent |
| Sessão do usuário no SSO | cookie cifrado + `AuthSession` | o cookie identifica, a linha permite revogar |
| Authorization code | Postgres | quem o resgata é o backend do RP, sem cookie; e uso único exige estado |
| Refresh token | Postgres | rotação com detecção de reuso exige registrar a família |

---

## 🔑 Fluxo OAuth 2.0 + PKCE

Endpoints em `routes/auth/`. A classe `AuthController` inteira é `@Public()`.

```
 App (krloc)                     SSO                         Google
     │                            │                            │
 1.  ├─ GET /sso/oauth/authorize ─►│                           │
     │   client_id, redirect_uri, response_type=code,          │
     │   code_challenge, code_challenge_method=S256, state     │
     │                            │                            │
     │        tem sessão viva? ───┴─► SIM: emite o code e volta ao passo 4
     │                            │
     │        NÃO: Set-Cookie sso_tx (cifrado, Lax, 300s)      │
     │             302 → SSO_LOGIN_URL (tela de login do front)│
     │                            │                            │
     │        a pessoa escolhe o Google na tela:               │
     │             GET /sso/oauth/google (state=<nonce>)       │
     │                            ├───────────────────────────►│
 2.  │                            │      consentimento         │
     │                            │◄───────────────────────────┤
 3.  │              GET /sso/oauth/google/callback             │
     │   confere nonce · valida e-mail e authId                │
     │   cria AuthSession · Set-Cookie sso_session             │
     │◄─ 302 redirect_uri?code=…&state=…&iss=… ┤               │
 4.  ├─ POST /sso/oauth/token ───►│                            │
     │   code, code_verifier, redirect_uri, grant_type,        │
     │   client_assertion (private_key_jwt)                    │
     │◄─ { access_token, token_type, expires_in, refresh_token }
```

### O que cada etapa valida

**`GET /oauth/authorize`** — a ordem importa e é normativa (RFC 6749 §4.1.2.1):

1. `client_id` existe? Se não, **erro exibido, sem redirect**.
2. `redirect_uri` está na lista branca, por **comparação de string exata**? Se não, **sem redirect**.
3. Daqui em diante todo erro **volta pela `redirect_uri`** com `error`, `error_description`, `state`
   e `iss`: `state` presente, `response_type=code`, `code_challenge_method=S256`, `code_challenge`
   no formato da RFC 7636 §4.1 (43 a 128 caracteres do conjunto unreserved).

Com sessão viva o code sai na hora. Sem ela, a transação vai para o cookie `sso_tx` e a pessoa vai
à tela de login do front, que oferece o Google.

### 🪪 A tela de login do IdP

Mora no `plataforma_sso-v1`, em `SSO_LOGIN_URL`, e é a mesma para toda aplicação do ecossistema.

- **Só oferece login com pedido pendente.** O pedido nasce em `/oauth/authorize` ou em
  `/session/login`, sempre porque uma aplicação viu alguém sem sessão. A tela lê o pedido em
  `GET /login/request`, que devolve o nome da aplicação e os provedores, ou 404. Sem pedido, ela
  explica que o login começa pela aplicação e não mostra botão. `GET /oauth/google` repete a regra do
  lado do servidor: sem transação, volta à tela com `error=no_pending_request`.
- **Recusa vira código, não texto.** `LoginPageRedirectException` leva a pessoa de volta à tela com
  `error=<código>`: `no_pending_request`, `request_expired`, `account_not_registered`,
  `email_not_verified`, `account_mismatch`, `provider_denied`, `provider_error`. O front traduz. Texto
  livre lido da URL na página de maior confiança do ecossistema seria um mural para phishing.
- **A tela não pode ser embutida.** `X-Frame-Options: DENY` e `frame-ancestors 'none'`, no Vite e no
  nginx. Clickjacking na tela de autorização é o caso da RFC 6749 §10.13.

**`GET /oauth/google/callback`** — confere o nonce devolvido pelo Google contra o guardado no cookie,
exige `email_verified`, recusa conta Google diferente da vinculada ao usuário, cria a `AuthSession`.

**`POST /oauth/revoke`** — RFC 7009. A §2 pede `MUST` para refresh token e `SHOULD` para access
token, e a §2.1 manda invalidar o que saiu do mesmo grant. **Os dois tipos são aceitos e derrubam a
mesma coisa:** a família de refresh tokens daquela sessão, naquele projeto. Com um access token, o
caminho é a claim `sid`. O `token_type_hint` é otimização, não instrução: não achou pela dica, o
servidor procura no outro tipo, como a §2.1 exige.

A validade do access token **não** é conferida na revogação, de propósito. Revogar a partir de um
token já expirado é o caso comum: a pessoa ficou parada e clicou em sair. Recusar ali deixaria a
família viva, que é o oposto do pedido.

⚠️ **O access token já emitido continua verificando até expirar.** Ele é assinado e conferido sem
consulta ao servidor, que é o que torna a arquitetura barata: o RP não fala com o SSO a cada
requisição. A RFC 10017 §6.2.4 reconhece esse limite. A mitigação é ele ser curto, 15 minutos, e é
por isso que esse número não deve crescer. Para quem pergunta ao SSO, a janela é outra: a
introspecção, abaixo, a encurta para 30 segundos no `sso-client`.

**`POST /oauth/introspect`** — RFC 7662. A aplicação pergunta se o grant do token vale e qual é o
papel **agora**. Autentica o cliente por `private_key_jwt`, como o token endpoint. Responde só
`{ "active": false }` se faltar qualquer uma destas coisas:

- assinatura, `iss` e `aud` do próprio cliente;
- `exp` no futuro;
- sessão viva da mesma pessoa;
- papel no projeto;
- um refresh token vivo no grant.

A última é a que torna a revogação completa: logout e revogação derrubam a família, e o access token do
mesmo grant passa a responder inativo junto, como a RFC 7009 §2.1 pede. Ativo devolve `roles` e `perm`
lidos do banco, extensões que a RFC 7662 §2.2 permite. Token de outro cliente responde inativo e não
erro (§2.2). Só o cliente que não se autentica recebe 401 (§2.3), o que inclui aplicação suspensa ou
com a chave revogada. O limite é próprio, 1200 por minuto por origem, porque cada sessão ativa de
cada aplicação pergunta a cada 30 segundos. Passando dele, o `sso-client` decide pelo token, como
fazia antes da introspecção, até a janela seguinte.

**`POST /oauth/token`** — autentica o cliente por `private_key_jwt`, consome o code atomicamente,
verifica PKCE em tempo constante, confere `redirect_uri` e emite o par de tokens. A `redirect_uri` do
code também precisa **continuar registrada**: apagar o endereço derruba na hora os codes emitidos para
ele, inclusive o de um login que ainda estava no Google.

### Contrato do access token

```jsonc
{
  "iss": "https://host/sso",
  "sub": "<User.id>",
  "aud": "<Project.clientId>",
  "jti": "<uuid>",
  "email": "…", "name": "…",
  "clientId": "<Project.clientId>",
  "roles": ["ADMIN"],
  "perm": "RhBT4JXdWgJ5",
  "sid": "<AuthSession.id>",
  "iat": 0, "exp": 0
}
```

Assinado em **RS256**, com `kid` no header. O RP verifica pelo JWKS e **não consegue emitir**.
Vida padrão de 900 segundos.

⚠️ **O token carrega `roles`, nunca a lista enumerada de rotas.** RFC 9068 §2.2.3.1, com o nome de
atributo do SCIM (RFC 7643 §4.1.2). A versão anterior embutia `permissions: [{path, method}]`, que
crescia com o número de rotas do projeto: com 38 rotas o token chegou a 3067 bytes, o cookie de
sessão do cliente passou de 4266 bytes e **o navegador passou a descartá-lo em silêncio**. Ninguém
conseguia logar, e nenhum teste pegava, porque `fetch` não aplica o limite de 4 KB do navegador.

`sid` é a sessão que originou o token (RFC 9068 §2.2.1). É a âncora de revogação: sem ela, um
`POST /oauth/revoke` trazendo um **access token** não teria como achar o grant correspondente, e a
RFC 7009 §2.1 ficaria por cumprir.

`perm` é a impressão digital do conjunto de permissões daquele papel. O cliente resolve `roles` em
rotas via `POST /oauth/permissions` e guarda o conjunto pela chave papel mais hash. Como o hash só
muda no token quando ele renova, o `sso-client` ainda pergunta de novo antes de negar uma rota e não
guarda nenhum conjunto por mais de 60 segundos: permissão concedida vale na requisição seguinte, e a
revogada, em até um minuto, ou em 30 segundos pela introspecção, que devolve o `perm` de agora. Papel
que não existe mais responde 404 ali, e o cliente o trata como conjunto vazio.

`roles` e `perm` são uma fotografia do momento da emissão. Quem decide com eles sem perguntar ao SSO
decide pelo papel de até 15 minutos atrás. A introspecção devolve os dois lidos do banco, e o
`sso-client` troca o token pela sessão assim que eles divergem.

---

## 🔑 Entrar com senha, e o segundo fator

O login federado ao Google continua, e ao lado dele há **e-mail e senha emitidas pelo SSO**. Ninguém
cria conta nem senha por conta própria: a linha de `User` nasce no console, e a de `UserPassword`
nasce quando um administrador emite. Os dois caminhos terminam no mesmo lugar, e **os dois exigem o
segundo fator por aplicativo**.

```
e-mail e senha ─┐                        ┌─ trocar a senha (primeiro acesso)
                ├─► primeiro fator ──────┤
Google ─────────┘                        ├─ cadastrar o segundo fator (primeiro acesso)
                                         └─ código de seis dígitos
                                                     │
                                            sessão + authorization code
```

- **A senha é coletada pela tela do IdP**, na origem do SSO, nunca pela aplicação. O grant de senha do
  OAuth (ROPC) não existe aqui, e é justamente o que a RFC 9700 §2.4 manda não usar.
- **A senha nasce no console** (`POST /sso/user/:id/password`), aparece **uma única vez** na resposta,
  com `Cache-Control: no-store`, e nasce com `mustChange`. No primeiro acesso a pessoa define a dela,
  e a partir daí ninguém mais a conhece. O mesmo padrão da chave de cliente.
- **Guardada com scrypt** (`N=2¹⁶, r=8, p=1`, sal de 16 bytes), do `node:crypto`: sem dependência
  nova, sem binário nativo, e o parâmetro fica gravado junto do hash, para poder subir depois.
- **Não há enumeração de conta.** E-mail que não existe e senha errada devolvem o mesmo
  `invalid_credentials`, e o caminho sem conta ainda paga um hash falso, para não responder na hora.
- **Cinco tentativas erradas bloqueiam por 15 minutos** (`account_locked`), contadas no banco, por
  conta — além do limite por origem do throttler, que é por IP.
- **O segundo fator é TOTP** (RFC 6238, seis dígitos, passo de 30 s, janela de ±1), compatível com
  Google Authenticator e qualquer outro. A pessoa cadastra no primeiro acesso: o QR aparece na tela
  dela, e o segredo não passa pelo administrador.
- **O segredo do TOTP fica cifrado** com a mesma `KEY_ENCRYPTION_KEY` que protege as chaves de
  assinatura: um dump do banco não gera código.
- **Código usado não vale duas vezes** (`lastStep`), e há oito **códigos de recuperação**, guardados
  em hash, de uso único, mostrados uma vez no fim do cadastro.
- **Perdeu o aplicativo:** o administrador reseta em `DELETE /sso/user/:id/mfa` e a pessoa cadastra
  de novo no acesso seguinte. **Perdeu a senha:** emitir outra, que nasce com `mustChange` de novo.

### As etapas, por dentro

Entre o primeiro fator e a sessão existe um **cookie de etapa** (`sso_step`, cifrado, 5 minutos), que
guarda quem passou pelo primeiro fator e em que etapa está. A transação do pedido (`sso_tx`) continua
exigida em toda etapa: sem pedido pendente, nenhuma delas responde. A sessão só nasce no fim, em
`completeLogin`, que é o mesmo caminho do retorno do Google.

| Rota | Etapa |
|---|---|
| `POST /sso/login/password` | e-mail e senha; devolve a próxima etapa |
| `POST /sso/login/password/change` | troca obrigatória do primeiro acesso |
| `POST /sso/login/mfa/setup` | começa o cadastro: devolve segredo e `otpauth://` |
| `POST /sso/login/mfa/confirm` | confirma com o código e devolve os códigos de recuperação |
| `POST /sso/login/mfa` | o código de quem já cadastrou; aceita código de recuperação |
| `GET /sso/login/request` | o pedido pendente e **em que etapa a pessoa está** |

Nenhuma delas devolve redirect: a tela recebe `{ next, redirectTo }` e navega. Quem não tem papel no
projeto recebe `next: "done"` com o `redirect_uri` carregando `error=access_denied`, o mesmo que o
caminho do Google entrega.

### Rotas administrativas da credencial

| Rota | O que faz |
|---|---|
| `GET /sso/user/:id/credential` | se há senha emitida, se falta trocar, até quando está bloqueada, se o segundo fator está cadastrado e quantos códigos de recuperação restam |
| `POST /sso/user/:id/password` | emite a senha e a devolve uma vez |
| `DELETE /sso/user/:id/password` | tira o login por senha daquela conta |
| `DELETE /sso/user/:id/mfa` | reseta o segundo fator |

Como toda rota administrativa nova, a raiz as alcança no mesmo deploy; os papéis de gestão, depois de
cadastradas no catálogo do projeto `SSO` e concedidas.

---

## 🛡️ Autorização das rotas administrativas

**O SSO é um `Project` de si mesmo.** O console administrativo entra pelo mesmo fluxo OAuth que o
krloc usa, recebe um access token com `aud` igual ao `clientId` desse projeto, e o que ele pode
fazer sai de `ProjectUser` → `Role` → `Permission`. A mesma regra das aplicações clientes, aplicada
ao próprio servidor.

`SSOAdminGuard` é `APP_GUARD` global e lê metadata em dois níveis:

| Decorator | Metadata | Comportamento |
|---|---|---|
| `@Public()` | `isPublic` | libera |
| `@Authenticated()` | `isAuthenticated` | exige token válido, dispensa permissão por rota |
| _(nenhum)_ | — | exige token válido **e** `Permission` para a rota pedida; sem ela, 404 |

O caso sem decorator é o normal e o mais fechado: **rota nova nasce protegida** e só responde depois
de existir como `Route` no catálogo, com `Permission` ligando algum papel a ela. Para quem não a
alcança, a resposta é o mesmo 404 do roteador para um caminho que não existe, `Cannot POST /sso/...`,
sem `WWW-Authenticate` (RFC 9110 §15.5.4): quem não pode usar a rota não descobre que ela existe. Sem
credencial continua 401.

**A raiz.** O papel `SUPERADMIN` do projeto `SSO` alcança toda rota administrativa sem consultar o
catálogo. É a única regra de acesso escrita no código, em `AdminAccessService.authorize`, e é o que
permite a um ambiente novo nascer: sem ela, ninguém teria permissão para cadastrar a primeira
`Permission`. Para a raiz, `GET /me` lista toda rota administrativa que o servidor expõe, lida do
próprio roteador pelo `AdminRoutesService`; é dessa lista que o console desenha menu e ações num
catálogo ainda vazio. Os outros papéis só veem o que `Permission` concede.

**Papéis têm nome livre.** `ARQUITETO`, `GESTOR_FINANCEIRO`: maiúsculas, dígitos e `_`. Todo projeto
nasce com `SUPERADMIN`, `ADMIN`, `MANAGER` e `VIEWER`, **vazios**: fora a raiz do SSO, nenhum nome dá
acesso por si. Uma pessoa tem um papel por projeto; trocar substitui o anterior, e tirar do projeto
revoga os refresh tokens dela ali.

### O que o guard confere, em ordem

1. `Authorization: Bearer` presente. Se não, 401 com `WWW-Authenticate` (RFC 6750 §3).
2. Header do JWT com `alg: RS256` e `kid`. O `alg` é fixo no que o AS emite, senão a confusão de
   algoritmo fica aberta, inclusive `none`.
3. Assinatura contra a `SigningKey` daquele `kid`, mais `iss`, `exp` e `nbf`.
4. `aud` igual ao `clientId` do projeto do SSO. **Sem isso o token do krloc abriria a administração:**
   mesma assinatura, mesmo emissor, outro público.
5. `ProjectUser` do `sub` nesse projeto. Sem vínculo, 404; só `GET /me` responde 403, para o
   console saber mostrar a tela de sem acesso.
6. A raiz passa direto. Os outros precisam de `Permission` do papel casando método e caminho; sem
   ela, 404.

### Duas credenciais, a mesma autorização

| Credencial | Quem usa | Escrita |
|---|---|---|
| `Authorization: Bearer`, com `aud` do projeto `SSO` | linha de comando e testes | sem exigência extra |
| cookie `sso_session`, a sessão do próprio SSO | o console, na mesma origem da API | `X-CSRF-Token` e `Origin` do console |

O console não troca code por token: ele entra pela tela de login com `GET /session/login`, que
confere a `redirect_uri` contra as do projeto `SSO` por igualdade exata e devolve só o `state`. Daí
em diante a sessão é a credencial (RFC 10017 §7.1, front e API na mesma origem). Nenhum token chega
ao JavaScript, e logout ou revogação da sessão valem na hora, sem prazo de token para esperar.

A defesa de CSRF é a mesma do `sso-client`: token de dupla submissão, cuja cópia que vale mora dentro
do cookie cifrado, e `Origin` recusado quando presente e diferente do issuer ou das `redirect_uri`
do projeto `SSO`. O console recebe o token em `GET /me`; quem entrou sem papel no console o recebe em
`GET /session`, senão nem conseguiria sair. Sessão criada antes disso ganha o token na primeira
chamada, com o prazo que ainda lhe resta.

Header `Authorization` presente vale sozinho: um Bearer ruim devolve 401 em vez de cair para o cookie.

**A claim `roles` do token é ignorada de propósito.** Ela é verdadeira, mas congelada na emissão:
tirar o papel de alguém só faria efeito quando o access token expirasse. O papel é relido do banco a
cada requisição, então apagar um `ProjectUser` derruba o acesso na hora. Há teste para isso.

O padrão de caminho é montado a partir da rota **guardada**, nunca da pedida. O contrário já existiu
no krloc: `new RegExp(req.path)` deixava um pedido a `/api/.*` casar com qualquer permissão.

### O projeto do próprio SSO é protegido

É por ele que toda a administração acontece. Se alguém apagasse, renomeasse ou suspendesse o projeto
`SSO`, ou desmontasse o catálogo dele, ninguém mais administraria nada, e todas as aplicações perderiam
a fonte dos papéis e das permissões. Por isso a regra mora no servidor, em
`global/access/selfProjectProtection.ts`, e vale para console, linha de comando e script.

| Pela API, no projeto `SSO` | Quem pode | Recusa |
|---|---|---|
| apagar, renomear ou tirar de `ACTIVE` | ninguém, nem a raiz | 403 `sso_project_protected` |
| criar, editar ou apagar rota, papel ou permissão | só a raiz | 403 `sso_project_protected` |
| vincular, trocar o papel ou tirar membro | só a raiz | 403 `sso_project_protected` |
| cadastrar ou apagar redirect URI; cadastrar, gerar ou revogar chave | só a raiz | 403 `sso_project_protected` |
| renomear ou apagar o papel `SUPERADMIN` | ninguém | 403 `sso_project_protected` |
| editar redirect URI | ninguém: cadastre a nova e apague a antiga | 403 `sso_project_protected` |
| tirar ou rebaixar o último `SUPERADMIN` | ninguém | 403 `sso_last_superadmin` |
| apagar a última redirect URI | ninguém | 403 `sso_redirect_uri_last` |
| apagar a redirect URI da origem que está pedindo | ninguém | 403 `sso_redirect_uri_in_use` |

No SSO, vincular alguém ou conceder uma rota é dar poder administrativo; antes desta regra, qualquer
papel com `POST /projectuser` punha uma conta como `SUPERADMIN`. Nas outras aplicações nada disso se
aplica: quem alcança a rota cria papéis, marca permissões e vincula pessoas livremente. Estas recusas
são 403 com código, e não 404, porque quem as recebe já alcança a rota: não há existência a esconder.
A exclusão de redirect URI do SSO roda em transação com a linha do projeto travada, para duas exclusões
simultâneas não apagarem as duas últimas. O console conhece o mesmo nome (`SELF_PROJECT_NAME`) só para
não oferecer o caminho fechado.

### Primeira subida de um ambiente

**Não há bootstrap, seed nem manifesto neste repositório.** Clonar o código não dá catálogo, rota nem
administrador a ninguém. Cada ambiente, dev, hlg ou prod, nasce de um SQL rodado **uma única vez** por
quem tem acesso ao Postgres dele, guardado fora de todo repositório: o projeto `SSO` ativo, os quatro
papéis padrão, a pessoa que será a raiz com o papel `SUPERADMIN` e a redirect URI do console.

O SSO confere isso na subida, em `AdminAccessService.onApplicationBootstrap`, e **não sobe** sem o
projeto `SSO` ativo, um `SUPERADMIN` e uma redirect URI. De pé sem isso, seria um servidor que ninguém
consegue administrar.

Daí em diante tudo acontece pelo console, como raiz: rotas, papéis de gestão, permissões, pessoas e
as outras aplicações.

---

## 🧭 Superfície de rotas

| Método | Rota | Nível |
|---|---|---|
| GET | `/sso/health` | público |
| GET | `/sso/.well-known/jwks.json` | público |
| GET | `/sso/.well-known/oauth-authorization-server` | público |
| GET | `/sso/oauth/authorize` · `/sso/oauth/google` · `/sso/oauth/google/callback` | público |
| POST | `/sso/oauth/token` · `/sso/oauth/revoke` · `/sso/oauth/permissions` · `/sso/oauth/introspect` | público, exige `private_key_jwt` |
| POST | `/sso/oauth/logout` | público |
| GET | `/sso/login/request` | público, o pedido pendente e a etapa em que a pessoa está |
| POST | `/sso/login/password` · `/sso/login/password/change` | público, com pedido pendente: primeiro fator e troca no primeiro acesso |
| POST | `/sso/login/mfa/setup` · `/sso/login/mfa/confirm` · `/sso/login/mfa` | público, com etapa aberta: cadastro e conferência do segundo fator |
| GET | `/sso/session` · `/sso/session/login` | público: estado da sessão e login do console |
| POST | `/sso/session/logout` | público, exige `X-CSRF-Token` |
| GET | `/sso/me` | autenticado, sem RBAC; devolve o `csrfToken` para quem veio pela sessão |
| GET POST | `/sso/user` · `/sso/project` · `/sso/route` · `/sso/role` | catálogo |
| GET · POST DELETE | `/sso/user/:id/credential` · `/sso/user/:id/password` · `/sso/user/:id/mfa` | catálogo: emitir senha, revogar e resetar o segundo fator |
| GET PUT DELETE | `/sso/user/:id` · `/sso/project/:id` · `/sso/route/:id` · `/sso/role/:id` | catálogo |
| GET · PATCH | `/sso/project/:id/overview` · `/sso/project/:id/status` | catálogo |
| POST · DELETE | `/sso/permission` · `/sso/permission/:id` | catálogo |
| POST | `/sso/projectuser` | catálogo |
| PUT DELETE | `/sso/projectuser/:projectId/:userId` | catálogo: trocar o papel e tirar do projeto |
| POST · PUT DELETE | `/sso/redirecturi` · `/sso/redirecturi/:id` | catálogo |
| GET POST · DELETE | `/sso/clientkey` · `/sso/clientkey/:id` | catálogo |
| POST | `/sso/clientkey/generate` | catálogo |

"Catálogo" quer dizer que nada no código diz quem alcança a rota: a raiz alcança todas, e os outros
papéis, o que `Permission` concede. Mudar quem alcança o quê é marcar ou desmarcar no console, sem
deploy. Rota administrativa nova precisa ser cadastrada no catálogo do projeto `SSO` e concedida aos
papéis de gestão; até lá, só a raiz a alcança.

---

## ⚙️ Variáveis de ambiente

| Chave | Uso |
|---|---|
| `DATABASE_URL` | PostgreSQL (lida em `PrismaService` via `dotenv/config`) |
| `SHADOW_DATABASE_URL` | banco descartável para `prisma migrate diff --from-migrations` |
| `SSO_ISSUER` | base pública sem barra final. Vira `iss` e prefixo do discovery |
| `SSO_LOGIN_URL` | tela de login do IdP, no front. Fato de deploy, como o issuer |
| `KEY_ENCRYPTION_KEY` | 32 bytes hex. Cifra as chaves privadas de assinatura em repouso |
| `COOKIE_SECRET` | 32 bytes hex. Cifra os cookies de transação e de sessão |
| `COOKIE_SECURE` · `COOKIE_SAMESITE` | atributos dos cookies. `false` só em localhost sem TLS |
| `ACCESS_TOKEN_TTL` | segundos, default 900 |
| `REFRESH_TOKEN_TTL` | segundos. É teto absoluto, nunca estendido na rotação. Hoje 90 dias |
| `AUTH_SESSION_TTL` | segundos. Hoje 90 dias. **Tem de ser ≥ `REFRESH_TOKEN_TTL`** |
| `GOOGLE_CLIENT_ID` · `GOOGLE_CLIENT_SECRET` · `GOOGLE_CALLBACK_URL` | credenciais do GCP |
| `TRUST_PROXY` | quantos saltos de proxy confiar no `X-Forwarded-For`. Sem ela, o limite de requisições conta todo mundo como o proxy; ligada sem proxy na frente, qualquer um escolhe o próprio IP |

⚠️ Perder `KEY_ENCRYPTION_KEY` invalida todas as chaves de assinatura gravadas.
`ConfigModule` é importado **sem `.forRoot()`**; o `.env` chega ao `process.env` porque
`PrismaService` faz `import 'dotenv/config'`. Remover esse import quebra tudo silenciosamente.

⚠️ **Não existe mais segredo de administração no ambiente.** `SSO_ADMIN_SECRET` e
`SSO_SUPERADMIN_SECRET` saíram: um segredo compartilhado torna administrador todo mundo que lê o
repositório, não registra quem agiu e só pode ser revogado para todos de uma vez. Quem administra é
um `User` com papel em `ProjectUser`.

⚠️ **`KEY_ENCRYPTION_KEY` e `COOKIE_SECRET` não podem vir do banco.** A primeira é o que decifra o
que está lá, então buscá-la de lá é circular. A segunda protege o cookie que carrega o identificador
de sessão usado para consultar o banco. As duas são anteriores ao banco por construção.

---

## 🧱 Convenções de código

- **Controller** só orquestra. Regra de negócio no service.
- **DTOs**: `create<X>.dto.ts` · `edit<X>.dto.ts` = `PartialType(Create<X>)` · `filter<X>.dto.ts` estende `Pagination`.
- **Paginação**: `PaginationConfig(filter)` → `{ page, limit }` como `skip`/`take`.
- `findAll` lança `ApiException('no_results')` com lista vazia (padrão do projeto, replicado no `krloc`).
- **Erro é código do catálogo**, `throw new ApiException('<codigo>')`. Ver "Contrato de erro", abaixo.
- Erros do Prisma: `PrismaExceptionFilter` e `PrismaExceptionValidationFilter`, os dois globais, em `main.ts`.
- Erros de OAuth: `OAuthException` e `AuthorizeRedirectException`, renderizados pelos filtros em
  `routes/auth/error/`. **Nunca** devolva o formato padrão do Nest nos endpoints OAuth.
- Tipos de `generated/prisma/client`; enums de `generated/prisma/enums`.

### 🚫 Contrato de erro

A API administrativa responde todo erro com o código no campo `error`:

```json
{ "statusCode": 404, "error": "project_not_found", "message": "projeto nao encontrado" }
```

- **O código é o contrato; o texto é do console.** O `plataforma_sso-v1` escolhe a frase pelo código, na
  língua da tela, e **nunca mostra `message`**. Ele é para quem lê a resposta crua, como o `detail` da
  RFC 9457 §3.1.4, e não leva valor da requisição nem detalhe interno.
- **O catálogo é `global/error/apiError.ts`**. As recusas que já tinham código continuam onde estão, no
  mesmo formato: a proteção do projeto `SSO` (`selfProjectProtection.ts`), as da redirect URI do
  console, as do anti-CSRF e da origem e o `no_pending_request`. Código novo entra no catálogo e no
  `constants/messages.ts` e nos JSON de tradução do console.
- **Validação de DTO** sai `validation_failed`, com `fields: [{ field, error, message }]`. O código do
  campo vem do `context` da regra: `role_name_invalid`, `public_key_not_pem`, `email_invalid`. Regra sem
  código sai `invalid_value`.
- **No OAuth o formato continua o da RFC 6749 §5.2.** O `OAuthValidationFilter` reescreve a recusa da
  validação como `invalid_request`, ou `unsupported_grant_type` quando só o `grant_type` falhou, com
  descrição fixa e `Cache-Control: no-store`.
- **Token recusado no guard administrativo** sai `invalid_token` (RFC 6750 §3.1), sem dizer qual
  conferência falhou: o motivo vai para o log. Dizer "kid desconhecido" ou "assinatura inválida" a quem
  mandou só ajuda a montar o próximo token forjado.
- **Erro do Prisma e falha interna** viram `duplicate`, `validation_failed` ou `internal_error`, e o
  texto fica no log: a mensagem do Prisma traz a consulta, e a da chave de assinatura nomeia a variável
  de ambiente.
- **O 404 de rota negada fica como o do roteador**, sem código, para continuar igual ao de caminho que
  não existe.

### ⚠️ Armadilha do `$transaction`

Não lance exceção de dentro de `prisma.$transaction` quando a transação também executa uma **ação de
segurança que precisa persistir**. O throw dispara rollback e desfaz a ação. Foi o que aconteceu com
a revogação por replay de code e por reuso de refresh token: a transação decide, devolve um resultado
discriminado, e o efeito colateral e a exceção acontecem **fora** dela. Os dois casos estão cobertos
por teste em `test/oauth-e2e.js`.

---

## 🚨 Pontos de atenção conhecidos

1. **`global/dto/jwtPayload.dto.ts`** (`sub/projectId/role/routes`) não corresponde ao payload
   realmente assinado. Tipo morto.
2. **Sem CORS, de propósito.** Console e API vivem na mesma origem (proxy do nginx em container,
   rewrite do hosting em produção), então não há requisição entre origens para liberar. Abrir CORS
   aqui só criaria superfície. `helmet` e o limite de requisições entraram; ver `PENTEST.md`.
3. **`jti` da asserção de cliente não é registrado.** A RFC 7523 §3 trata isso como MAY, e reapresentar
   a asserção sozinha não rende nada porque o code já é de uso único. Vale rever se surgir outro grant.
4. **`PaginationConfig`**: piso 10 e teto 500 (`MAX_LIMIT`). O teto entrou na revisão de segurança:
   sem ele, `?limit=1000000` devolvia o catálogo inteiro numa resposta.
5. **`getProjecIdByClientId`** — typo, no `ProjectService`.
6. **Não há rotina agendada** chamando `purgeExpired()` de `AuthorizationCodeService` e
   `AuthSessionService`. As linhas expiradas acumulam. O método da sessão já apaga os dependentes
   antes, então a rotina, quando existir, não vai esbarrar na chave estrangeira.
7. **Não há trilha de auditoria** das ações administrativas: as tabelas guardam o estado, não quem o
   mudou. É o item de maior prioridade no `PENTEST.md`.
8. **Rota administrativa nova não entra sozinha no catálogo do SSO.** A raiz a alcança no mesmo
   deploy; os papéis de gestão, só depois que ela for cadastrada no projeto `SSO` e concedida a eles.
   Até lá eles recebem 404. Falha fechado, que é o lado certo de errar.

### ✅ Já corrigidos

- **O console reconhecia o erro pela frase**, e o texto desconhecido aparecia cru na tela. Agora todo
  erro sai com código (ver "Contrato de erro"). Junto saíram do corpo o texto interno do Prisma, o nome
  da variável da chave de assinatura, o motivo exato da recusa do Bearer e a origem repetida na recusa
  de escrita. Ver `PENTEST.md`, SSO-12. A recusa de validação no token endpoint, que saía no formato do
  Nest, passou ao da RFC 6749 §5.2.
- Assinatura migrada de HS256 com segredo compartilhado para **RS256 com JWKS**.
- Autenticação de cliente por **`private_key_jwt`** (RFC 7523 §2.2).
- **Redis removido.** Transação e sessão em cookie cifrado; code e refresh token no Postgres.
- Authorization code com **uso único atômico** e revogação em caso de replay.
- **Refresh token com rotação** e detecção de reuso que derruba a família.
- Erros no formato da RFC 6749 §5.2, e na ordem da §4.1.2.1 no authorize.
- `expires_in` numérico em segundos e `Cache-Control: no-store` no token endpoint.
- `code_challenge` e `code_verifier` validados contra a ABNF da RFC 7636 §4.1.
- Parâmetro `iss` na resposta do authorize (RFC 9207, anti mix-up).
- Nonce próprio no leg SSO → Google, fechando o CSRF que o `state: false` deixava aberto.
- `email_verified` exigido e `authId` conferido a cada login.
- `@prisma/adapter-pg` e `@nestjs/swagger` movidos para `dependencies`.
- `Role` ganhou FK com `Project` e unique `(name, projectId)`.
- `ProjectService.createProject` passou a devolver o registro criado, com o `clientId`.
- Dependências não usadas removidas: `ioredis`, `bcrypt`, `cache-manager`, `@nestjs/axios`, `passport-jwt`.
- **Segredo estático de administração removido.** `SSO_ADMIN_SECRET` e `SSO_SUPERADMIN_SECRET`
  saíram do código e do ambiente. O SSO virou `Project` de si mesmo e a autorização passou a sair
  de `ProjectUser` → `Role` → `Permission`, relidos a cada requisição.
- **`SSOAdminGuard` deixou de usar um `JwtService` sem segredo configurado.** Não há mais ramo que
  estoure 500: o guard verifica a assinatura contra a própria `SigningKey`.
- **`RouteController` usava `@Delete('id')`** sem os dois pontos, e a rota era literalmente
  `/route/id`. Agora é `@Delete(':id')`.
- **`RedirectUriController.createRedirectUri` tipava o `@Body()` como o model do Prisma**, e o
  `ValidationPipe` não validava nada. Agora usa o DTO, e campo a mais é recusado.
- **O overview não trazia ids.** `redirectUriRecords` e o `id`/`routeId` de cada permissão existem
  para a gestão conseguir editar e revogar sem cruzar outras rotas.
- **Não havia como apagar redirect URI.** `DELETE /sso/redirecturi/:id` tira o endereço de circulação,
  e o token endpoint recusa code emitido para ele antes da exclusão.
- **`PermissionService.deletePermission`** chamava `delete` e só depois testava o retorno, com um `if`
  morto e P2025 no lugar do 404. Agora busca antes, e sabe de qual projeto a permissão é.
- **O projeto `SSO` podia ser apagado, renomeado, suspenso ou desmontado pela API**, e com ele a
  administração de todas as aplicações. Ver "O projeto do próprio SSO é protegido".
- **Um papel de gestão podia se promover.** Vincular alguém ao projeto `SSO`, ou conceder rota ali,
  só conferia a permissão da rota, e qualquer papel com `POST /projectuser` punha uma conta como
  `SUPERADMIN`. Agora só a raiz escreve no SSO.
- **Papel era enum** (`RoleEnum`). Virou texto livre, com os quatro padrão criados vazios em todo
  projeto; a migration `20260914120000_role_name_text` converteu a coluna e criou os que faltavam.
- **Rota negada respondia 403**, e com isso confirmava que a rota existe. Agora é 404, aqui e no
  `sso-client`.
- **Não havia como trocar o papel de um membro nem tirá-lo do projeto.** Agora há
  `PUT` e `DELETE /sso/projectuser/:projectId/:userId`.
- **`bootstrap-sso.js`, `register-app.js` e `operator-token.js` saíram.** Clonar o repositório dava a
  qualquer um o catálogo inteiro e o caminho para se tornar administrador de um banco novo.
- **Mudança no SSO só chegava à aplicação na renovação do token.** Papel trocado, pessoa tirada do
  projeto, aplicação suspensa e logout só pesavam quando o access token vencia, em até 15 minutos.
  Agora há `POST /oauth/introspect` (RFC 7662), anunciado no discovery, e o `sso-client` 0.4.0
  pergunta a ele: a janela caiu para 30 segundos, com token novo emitido na hora quando o papel muda.
  O discovery também passou a anunciar `refresh_token` em `grant_types_supported`, que o token
  endpoint já aceitava.
- **Rodada de segurança de 17/09/2026** (detalhe, nota e vetor CVSS em [`PENTEST.md`](PENTEST.md)):
  - dependências de produção com vulnerabilidade conhecida, 17 delas altas, zeradas com `npm audit fix`
    e `overrides` (`multer`, `mysql2`, `deepmerge-ts`). ⚠️ subir `@nestjs/core` sem subir
    `@nestjs/common` junto derruba o boot com `Cannot find module '…/sse-signal.decorator'`;
  - **limite de requisições** por origem, com `@nestjs/throttler`: 600/min geral, 120/min no token
    endpoint e no revoke e 1200/min na introspecção, com o guard antes do de acesso;
  - **`helmet`** com política fechada (`default-src 'none'`), `X-Frame-Options: DENY`,
    `Referrer-Policy: same-origin`, e `X-Powered-By` fora;
  - **teto de 500 no `limit`** da paginação;
  - **`normalizePath`** tirava `/v1` de qualquer posição do caminho, e uma permissão passava a valer
    para outra rota. Agora só o prefixo, e só como segmento inteiro;
  - **`purgeExpired()` da sessão** apagava a linha com dependente e falhava inteira; agora apaga code
    e refresh token antes, em transação.
- **Usuário sem projeto não se apagava.** A `AuthSession` dele segurava a linha, o banco recusava e a
  resposta virava 500. Agora `DELETE /sso/user/:id` roda em transação, com a pessoa e as sessões dela
  travadas, e leva junto sessões, refresh tokens e authorization codes — o que equivale a revogar cada
  grant (RFC 7009 §2.1). O vínculo com projeto continua barrando, com 400.
- **Projeto novo nascia sem o papel `SUPERADMIN`.** `DEFAULT_ROLE_NAMES` tinha três nomes, a
  documentação e o teste esperavam quatro, e os projetos do banco tinham os quatro. O nome não dá
  poder nenhum: a raiz é o `SUPERADMIN` do projeto `SSO`, conferido por nome de projeto.
- **Erro redirecionado voltava sem `iss`.** A RFC 9207 §2 o exige em toda resposta de autorização,
  inclusive a de erro, e o `AuthorizeRedirectExceptionFilter`, que devolve o `access_denied` de quem
  não tem papel no projeto, mandava só `error`, `error_description` e `state`. O discovery também
  passou a anunciar `authorization_response_iss_parameter_supported`, exigido pela §2.3.

---

## ✅ Invariantes ao alterar

- `redirect_uri` **sempre** por comparação exata. Nunca prefixo, nunca regex.
- `code_challenge_method` restrito a `S256`.
- Toda resposta que volta pela `redirect_uri`, de sucesso ou de erro, leva `iss`, com o mesmo valor
  do `issuer` do discovery (RFC 9207 §2 e §2.3).
- Authorization code de uso único, com vida em segundos.
- Refresh token rotativo, com teto absoluto herdado pela família.
- A introspecção só responde ativo com sessão viva, papel no projeto e refresh token vivo no grant, e
  inativo nunca diz por quê (RFC 7662 §2.2). Tirar a exigência do refresh token faz o logout voltar a
  ser cosmético para o access token já emitido.
- Chave privada de assinatura nunca sai do processo em claro nem vai para o banco em claro.
- Rode `npm run test:oauth` depois de mexer em `routes/auth/` ou em `global/access/`.
- Rota administrativa nova **não** ganha decorator de nível: ela entra no catálogo do projeto `SSO`,
  pelo console, e ganha `Permission`. Quem decide acesso é o banco; o código só conhece a raiz.
- Rota negada responde 404, igual a caminho que não existe. Não volte a responder 403 ali.
- Erro sai com código do catálogo `global/error/apiError.ts`, ou do formato da RFC 6749 no OAuth. `message`
  não leva valor da requisição nem detalhe interno, e token recusado não diz por quê.
- Nada de bootstrap, seed ou manifesto com catálogo, papel ou administrador no repositório. Ambiente
  novo nasce do SQL de primeira subida, que fica fora dele.
- Nenhum segredo de administração volta para o ambiente.
- A tela de login só oferece provedor com pedido pendente, e erro para ela vai como código.
- Senha nunca é coletada pela aplicação, só pela tela do IdP. O grant de senha do OAuth não volta.
- Senha emitida aparece uma vez, nasce com `mustChange` e some do servidor em hash de scrypt. Conta
  nova não ganha senha sozinha, e ninguém se cadastra.
- E-mail desconhecido e senha errada respondem o mesmo `invalid_credentials`, e o caminho sem conta
  paga o mesmo tempo de hash.
- O segundo fator é exigido nos dois caminhos, Google inclusive, e o segredo dele fica cifrado com
  `KEY_ENCRYPTION_KEY`. Código usado não vale de novo.
- Escrita administrativa pela sessão exige `X-CSRF-Token` e origem do console. Não afrouxe.
- Nada aqui lê arquivo de outro repositório.
- O projeto `SSO` não se apaga, não se renomeia e não sai de `ACTIVE`; o catálogo, os membros, as
  redirect URIs e as chaves dele só a raiz mexe; o papel `SUPERADMIN` dele não se renomeia nem se
  apaga, e sempre sobra um. Escrita nova que toque projeto, rota, papel, permissão, membro, redirect
  URI ou chave passa por `global/access/selfProjectProtection.ts`, com teste em `test/oauth-e2e.js` e
  em `selfProjectProtection.spec.ts`.
