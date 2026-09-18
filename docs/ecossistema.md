# 🧭 Ecossistema do SSO

Um SSO próprio com OAuth 2.0 Authorization Code + PKCE, RBAC por projeto, e as aplicações que se
conectam a ele. Este documento mora no repositório do SSO porque é o SSO que define as regras para
quem se conecta. Cada repositório tem o próprio `CLAUDE.md` com arquitetura, convenções e pontos de
atenção. **Leia o do repositório que você vai tocar antes de mexer.**

| Repositório | Papel | Stack | Prefixo | Porta local |
|---|---|---|---|---|
| [`sso-api-v1`](https://github.com/PedroLucasLopes/sso-api-v1) | Authorization Server + catálogo RBAC | NestJS 11 · Prisma 7 · Postgres | `/sso` | 8080 |
| [`plataforma_sso-v1`](https://github.com/PedroLucasLopes/plataforma_sso-v1) | tela de login do IdP e console do SSO | Vue 3 · Vuetify 4 · Pinia · Vite 8 | — | 5173 |
| [`krloc-api-v1`](https://github.com/PedroLucasLopes/krloc-api-v1) | Relying Party — locação de equipamentos | NestJS 11 · Prisma 7 · Postgres | `/api` | 3000 |
| [`plataforma_krloc-v1`](https://github.com/PedroLucasLopes/plataforma_krloc-v1) | front da locação de equipamentos | Vue 3 · Vuetify 4 · Pinia · Vite 8 | — | 5174 |
| [`sso-lib-v1`](https://github.com/PedroLucasLopes/sso-lib-v1) | `@pedrolucaslopes/sso-client`: autenticação das APIs | NestJS module · TypeScript | — | — |
| [`components_storybook-v1`](https://github.com/PedroLucasLopes/components_storybook-v1) | `@pedrolucaslopes/dotlog-ui`: componentes, tema e Storybook | Vue 3 · Vuetify 4 · Storybook 10 | — | 6007 |

**Nenhum repositório depende de outro por caminho.** Cada um instala, faz build, sobe container e
publica de dentro de si. O SSO chega aos outros por HTTP; `sso-lib-v1` e `components_storybook-v1`
chegam como pacotes publicados no GitHub Packages, instalados por versão.

---

## 🧩 As aplicações são independentes

O SSO é um **ecossistema de autenticação**, não um guarda-chuva de repositórios. Cada aplicação que
se conecta a ele tem repositório, infraestrutura, banco, deploy e ciclo de vida próprios. O
`krloc-api-v1` é a primeira; um dashboard de métricas financeiras seria a segunda, e nada nele
precisaria saber da existência do primeiro.

**O que é compartilhado, e só isso:**

| Compartilhado | O que é |
|---|---|
| O SSO | um serviço, alcançado por HTTP. Nunca por import, nunca por banco |
| `@pedrolucaslopes/sso-client` | um pacote npm. É o contrato de autenticação, e viaja junto com cada API |
| `@pedrolucaslopes/dotlog-ui` | um pacote npm. É o contrato de interface: cada front instala, nenhum importa a pasta da biblioteca |
| O catálogo RBAC | linhas no banco do SSO, administradas pela API dele |

**O que nenhuma aplicação faz:** importar código de dentro do repositório de outro projeto, ler
arquivo de configuração de outro, tocar no banco de outro, apontar alias, `paths` ou contexto de
build para uma pasta vizinha, ou entrar no `docker-compose.yml` de outro. Se algo assim aparecer num
diff, é regressão.

O teste de integração é a tentação óbvia, porque ele precisa simular um login federado que nenhuma
automação consegue fazer. A saída é `@pedrolucaslopes/sso-client/testing`, um ponto de entrada
separado do pacote, com as ferramentas que criam sessão e token contra um SSO de verdade. Elas exigem
credenciais de operador do SSO alvo, que a aplicação recebe no **próprio** `.env.test`. Ver o
`.env.test.example` do `krloc-api-v1`.

### Conectar uma API nova

1. No console do SSO, criar o projeto. Ele nasce `PENDING`, com os papéis `SUPERADMIN`, `ADMIN`,
   `MANAGER` e `VIEWER`, todos vazios.
2. Cadastrar as redirect URIs e as rotas da aplicação, criar os papéis de nome livre que ela precisar,
   como `ARQUITETO`, e marcar as rotas de cada papel. Não há manifesto nem script: o catálogo mora no
   banco do SSO, e só nele.
3. Gerar a chave de cliente, entregar a privada ao dono da aplicação, associar os usuários, ativar o
   projeto. Ver "Cadastrar uma aplicação nova", abaixo.
4. Na aplicação, `.npmrc` do registro, `npm i @pedrolucaslopes/sso-client` e uma linha no
   `app.module.ts`: `SsoClientModule.forRootFromEnv()`. Front novo instala também
   `@pedrolucaslopes/dotlog-ui` e `vue-i18n`, com um JSON de tradução por língua: o menu do usuário
   lista as línguas sozinho. A marca dele entra no `DlAppShell` por `logo`, o mesmo ícone da aba do
   navegador; sem ela, o menu mostra um ícone neutro. O `plataforma_krloc-v1` é o modelo de front para
   uma API assim.
5. Preencher o `.env` dela: `SSO_ISSUER`, `APP_CLIENT_ID`, a chave privada, `APP_BASE_URL`,
   `COOKIE_SECRET`. Faltando alguma, a aplicação não sobe e diz quais faltam. Com front, também
   `APP_LOGIN_ERROR_REDIRECT`, a tela pública dele que explica login recusado: sem ela, quem o SSO
   recusa, como uma conta sem papel no projeto, recebe JSON no callback. Em container, também
   `SSO_INTERNAL_URL=http://host.docker.internal:8080/sso`: lá dentro, o `localhost` do issuer é o
   próprio container.

Nada além disso. A aplicação nova tem o próprio `docker-compose.yml`, não compartilha banco e não
precisa que o `krloc-api-v1` exista.

### Erro sai com código

Toda API do ecossistema responde erro com um código estável no campo `error`, e o front escolhe o
texto por ele, na língua da tela:

```json
{ "statusCode": 404, "error": "equipment_not_found", "message": "Equipment not found" }
```

- **O `message` nunca vai para a tela.** Ele é para quem lê a resposta crua, como o `detail` da
  RFC 9457 §3.1.4, que desaconselha o consumidor de interpretá-lo. Mostrado, ele seria o caminho de um
  detalhe interno ou de um valor repetido da requisição até a pessoa.
- **Valor que a tela precisa vai num membro próprio do corpo** (RFC 9457 §3.2), nunca dentro do texto.
- **Código desconhecido cai na mensagem do status.** Código novo na API é acréscimo; renomear um quebra
  o front que o traduz.
- **O `sso-client` segue o mesmo contrato**, e o OAuth, o da RFC 6749 §5.2.

O `krloc-api-v1` e o `plataforma_krloc-v1` são o modelo: catálogo em `src/global/error/apiError.ts`, e
tradução em `src/constants/messages.ts` e `errors.code.*` dos JSON.

---

## 📦 Pacotes compartilhados

| Pacote | Repositório | Quem instala |
|---|---|---|
| `@pedrolucaslopes/sso-client` | `PedroLucasLopes/sso-lib-v1` | toda API ligada ao SSO; hoje, o `krloc-api-v1` |
| `@pedrolucaslopes/dotlog-ui` | `PedroLucasLopes/components_storybook-v1` | todo front do ecossistema; hoje, o `plataforma_sso-v1` e o `plataforma_krloc-v1` |

- **Privados, no GitHub Packages.** Instalar exige um token **clássico** com `read:packages`, porque o
  registro não aceita token fine-grained. Cada consumidor versiona um `.npmrc` que só diz onde buscar
  e lê o token de `NODE_AUTH_TOKEN`; o token nunca entra em arquivo.
- **Publicar:** `npm version patch` e `git push --follow-tags` no repositório do pacote. A tag `v*`
  dispara o workflow que confere a versão e publica com o `GITHUB_TOKEN` da própria execução.
- **O campo `repository` do `package.json` liga o pacote ao repositório no GitHub Packages.** Renomeou
  o repositório, atualize o campo antes da próxima publicação.
- **Testar mudança antes de publicar:** `npm pack` no pacote e `npm install --no-save <arquivo .tgz>`
  no consumidor. O `package.json` e o lockfile não mudam, e a próxima instalação normal volta à versão
  publicada. Nada de alias, `npm link` ou workspace: é assim que o acoplamento volta sem ninguém ver.

Já houve uma pasta de fora com workspace npm e, depois, um compose único para tudo. Nada disso existe
mais: cada repositório instala, faz build e sobe container sozinho.

---

## 🐳 Ambiente local

Um `docker-compose.yml` **por repositório**, arquiteturas monolíticas preservadas. Não há rede
compartilhada nem ordem de subida: cada aplicação chega ao SSO pela porta que ele publica na máquina,
`host.docker.internal:8080`, do mesmo jeito que chegaria a um SSO hospedado em outro lugar.

| Repositório | Serviços | Configuração |
|---|---|---|
| `sso-api-v1` | `sso-migrate` · `sso` | `.env.docker` |
| `krloc-api-v1` | `krloc-migrate` · `krloc` | `.env.docker`, com `SSO_INTERNAL_URL=http://host.docker.internal:8080/sso` |
| `plataforma_sso-v1` | `sso-plataforma` | nenhum arquivo: `SSO_UPSTREAM` está no próprio compose |
| `plataforma_krloc-v1` | `krloc-plataforma` | nenhum arquivo: `KRLOC_UPSTREAM` está no próprio compose |

Na primeira vez, em cada API:

```bash
cp .env.example .env.docker
```

Para subir, na raiz de cada repositório:

```bash
docker compose up -d --build --wait
```

O login só funciona com o SSO de pé, mas nenhum container espera por ele para ficar saudável.

> O build do `krloc-api-v1`, do `plataforma_sso-v1` e do `plataforma_krloc-v1` instala pacotes do GitHub Packages, que exige
> token até para ler. Rode o compose num terminal com `NODE_AUTH_TOKEN` no ambiente: ele entra como
> secret do BuildKit, só durante o `npm ci`, e não fica em camada nenhuma da imagem.

A porta do host muda com `SSO_PORT`, `KRLOC_PORT`, `PLATAFORMA_PORT` e `KRLOC_PLATAFORMA_PORT`. Mudou a
do SSO, mude junto o `SSO_INTERNAL_URL` do krloc e o `SSO_UPSTREAM` do console. Mudou a do front do
KRLoc, mude junto o `APP_BASE_URL` do krloc e a `redirect_uri` do projeto KRLoc no SSO; mudou a da API
do KRLoc, mude o `KRLOC_UPSTREAM` do front.

**Não há serviço de Postgres em compose nenhum.** Os containers falam com o Postgres **nativo** da
máquina, por `host.docker.internal`. Um banco próprio no compose criava um segundo mundo, vazio: o
trabalho feito nele não aparecia no ambiente real, e o inverso também.

**Não há Redis.** Estado de transação e sessão vivem em cookie cifrado; authorization code e refresh
token vivem no Postgres, onde uso único e detecção de reuso podem ser atômicos.

Migration roda em serviço separado de propósito. Migrar no boot da aplicação gera corrida entre
réplicas assim que houver mais de uma instância.

### Onde mora cada variável

| Arquivo | Conteúdo | No git |
|---|---|---|
| `.env.docker` do `sso-api-v1` | conexão, `SSO_ISSUER`, `SSO_LOGIN_URL`, as duas chaves de cifra, TTLs, credencial do Google | ignorado, com `.env.example` |
| `.env.docker` do `krloc-api-v1` | conexão, endereços do SSO, identidade do cliente, cookie | ignorado, com `.env.example` |
| `.env` de cada API | o mesmo papel, para `npm run start:dev` fora do container | ignorado |
| `.env.test` do `krloc-api-v1` | configuração do teste ponta a ponta | ignorado, com `.env.test.example` |
| ambiente do shell | `NODE_AUTH_TOKEN`, token clássico do GitHub com `read:packages` para os pacotes privados | nunca em arquivo |

**Nenhum `clientId`, `projectId` ou e-mail de usuário vive em `.env`.** São linhas do banco do SSO,
e repeti-las no ambiente cria uma segunda verdade que envelhece calada. As duas exceções estão
marcadas no `.env.example` do `krloc-api-v1`, e cada uma tem razão técnica: o `APP_CLIENT_ID` é como a
aplicação se identifica **antes** de poder perguntar qualquer coisa, e a chave privada não pode
estar no banco porque um dump permitiria personificar toda aplicação registrada.

> ⚠️ **`docker compose config` imprime os segredos.** A saída resolve os `env_file` e escreve cada
> variável do `.env.docker` em claro, chaves e segredos incluídos. Para validar o arquivo, use
> `docker compose config --quiet`; para listar serviços, `--services`.

> ⚠️ **O compose lê o `.env` da pasta para interpolar o próprio arquivo.** Nas APIs, esse `.env` é o de
> `npm run start:dev`. Ele não entra no container, que usa o `.env.docker`, mas uma `SSO_PORT` escrita
> ali muda a porta publicada.

> ⚠️ **Use `127.0.0.1`, não `localhost`, em comandos Prisma na máquina.** O Postgres nativo escuta
> em `0.0.0.0:5432`; quando havia também um container na mesma porta, `localhost` resolvia IPv4
> primeiro e as conexões iam silenciosamente para o banco errado.

> ⚠️ **O Postgres desta máquina está em `America/Sao_Paulo`.** O Prisma grava e lê `DateTime` como
> UTC, e o `now()` do Postgres devolve hora local numa coluna `timestamp` sem fuso. SQL cru que
> precise combinar com o Prisma tem de usar `(now() AT TIME ZONE 'utc')`, senão a linha nasce três
> horas no passado. Foi o que fez as sessões dos testes nascerem expiradas.

> ⚠️ **`setx` só vale para terminal aberto depois.** Um `NODE_AUTH_TOKEN` gravado com `setx` não
> chega ao terminal que já estava aberto, e o npm manda o texto literal `${NODE_AUTH_TOKEN}`: o GitHub
> responde 401 "User cannot be authenticated with the token provided". Abra outro terminal.

### Armadilhas de build já pagas

- `nest build` emite `dist/src/**` e `dist/generated/**`, porque o `rootDir` inferido é a raiz comum
  de `src/` e `generated/`. O `start:prod` do SSO e do krloc aponta para `node dist/main`, que **não
  existe**. Os Dockerfiles usam o caminho certo.
- `@prisma/adapter-pg`, `@prisma/client` e o pacote do `PartialType` são exigidos em **produção**.
  Estavam em `devDependencies` e derrubavam o container com `MODULE_NOT_FOUND`.
- `prisma migrate dev` é interativo e falha em shell não interativo ao pedir confirmação de aviso de
  constraint. Gere o SQL com `migrate diff` para um arquivo temporário, mova para a pasta da
  migration e aplique com `migrate deploy`. Não crie a pasta antes do diff, senão dá P3015.
- O client do Prisma 7 é TypeScript puro compilado pelo `tsc`, sem engine nativo nem wasm. Alpine é
  seguro e não há `binaryTarget` a declarar.
- `npm install --prefix <pasta>` rodado de um diretório com `package.json` instala esse diretório como
  dependência `file:..` da pasta, com uma junção em `node_modules` apontando para cima. Instale de
  dentro da pasta. `npm run <script> --prefix` não tem o problema.
- No Windows PowerShell 5.1, `Remove-Item -Recurse` segue junção e apaga o **conteúdo do destino**.
  Para limpar `node_modules` com link de pasta, apague o link sozinho antes
  (`[System.IO.Directory]::Delete(caminho, $false)`).
- Ao tirar um projeto de um workspace, um `package-lock.json` antigo dentro da pasta volta a mandar.
  Foi o que aconteceu no krloc: o lock de antes do workspace reinstalou NestJS 11.1, axios 1.13 e
  Prisma 7.4, com duas vulnerabilidades críticas. Compare `npm outdated` com o que rodava e rode
  `npm update`, que fica dentro das faixas declaradas.

---

## ☁️ Alvo de deploy: GCP no custo mínimo

| Recurso | Cota Always Free | Região |
|---|---|---|
| Cloud Run | 2 mi req/mês · 360 mil GB-s · 180 mil vCPU-s | qualquer |
| Compute Engine `e2-micro` | 1 instância · 30 GB disco | só us-west1, us-central1, us-east1 |
| Cloud Storage | 5 GB · 100 GB egresso | só us-west1, us-central1, us-east1 |
| Artifact Registry | 0,5 GB | qualquer |

- **Postgres na `e2-micro`**, não em Cloud SQL, que não tem tier gratuito.
- **Nada em `southamerica-east1`.** São Paulo não entra no Always Free.
- **Sem load balancer.** Ele tem custo fixo mensal. Use rewrites do Firebase Hosting para rotear
  `/sso`, `/api` e `/` sob **um único domínio**.
- **Sem serviço de middleware separado.** Ele entraria no caminho de toda requisição, dobrando a
  contagem contra os 2 milhões gratuitos e somando cold start. Por isso a autenticação é
  biblioteca, não processo.
- **O token dos pacotes é do pipeline de build**, guardado como secret dele. A aplicação em execução
  não fala com o GitHub Packages e não precisa de token nenhum.

Origem única não é só economia: ela dispensa CORS e deixa o prefixo `__Host-` viável nos cookies,
que é o que a RFC 10017 §6.1.3.2 recomenda.

> `SameSite=Strict` **não** depende de origem única. `SameSite` compara **site**, e site ignora
> porta e subdomínio: `app.exemplo.com` e `sso.exemplo.com` são o mesmo site. O que quase impediu
> o `strict` foi outra coisa, a cadeia de redirects que volta do Google. Está resolvido e
> explicado no [`CLAUDE.md` da biblioteca](https://github.com/PedroLucasLopes/sso-lib-v1/blob/main/CLAUDE.md).

---

## 🔐 Estado do refactor de autenticação

Os diagramas do fluxo, no estilo da RFC 6749, estão em [`arquitetura-oauth.md`](arquitetura-oauth.md):
camadas, login completo, requisição autenticada, single sign-on no segundo app, logout e o portão de
ativação.

RFCs: 6749 (core), 7009 (revogação), 7523 (client assertion), 7636 (PKCE), 7662 (introspecção),
8414 (discovery), 9207 (issuer na resposta), 9700 (security BCP), 10017 (browser-based apps BCP).

### Feito

1. **RS256 com JWKS.** Saiu o `JWT_SECRET` simétrico compartilhado. O SSO assina com chave privada
   e publica `/.well-known/jwks.json`; o RP verifica só com a pública e não consegue emitir.
2. **`private_key_jwt`** no token endpoint e no revoke. As aplicações são backends registrados no
   SSO, e a RFC 10017 §6.2.3.1 exige que um token-mediating backend atue como cliente confidencial.
3. **Access token de 15 minutos + refresh token rotativo** com detecção de reuso que derruba a família.
4. **Redis removido** dos dois lados.
5. **Sessão do usuário com o SSO**, que é o que faz o segundo projeto entrar sem passar de novo pelo Google.
6. **Portão de ativação.** `Project` nasce `PENDING`. A autorização para usar o SSO nasce dentro do
   SSO: sem ativação por administrador, `/authorize` e o token endpoint recusam o cliente.
7. **Revogação (RFC 7009).** Logout deixa de ser cosmético: mata a família de refresh tokens no
   servidor, não só o cookie do navegador.
8. **`@pedrolucaslopes/sso-client`**, a camada de autenticação como biblioteca, no repositório `sso-lib-v1`. Uma API nova é
   `SsoClientModule.forRootFromEnv()` mais variáveis de ambiente.
9. **Defesa de CSRF e `SameSite=Strict`.** Escrita autenticada por cookie exige o header
   `X-CSRF-Token`, com token de dupla submissão cuja cópia autoritativa vive dentro do cookie
   cifrado. Os cookies de sessão passaram a `strict`; para isso o callback devolve um documento da
   própria origem em vez de `302`, senão o retorno do Google cairia num laço de login.
10. **Sessão longa, token curto.** Refresh token e `AuthSession` a 90 dias, cookie de sessão junto;
    access token em 15 minutos. Tudo que é longo mora no servidor e é revogável; a única credencial
    que não pode ser cancelada é o access token, então ela é a única curta. Revogar por qualquer um
    dos dois tokens derruba o grant inteiro (RFC 7009 §2.1).
11. **Relogin automático.** Sessão morta não devolve mais um 401 seco. Navegação de página vira
    `302` para o login e a pessoa volta à URL que pediu; chamada de API devolve 401 com
    `error: "login_required"` e o endereço do login, e o `returnTo` sai do `Referer`, que é a tela
    do front onde ela estava.
12. **Administração autorizada pelo banco.** Saíram `SSO_ADMIN_SECRET` e `SSO_SUPERADMIN_SECRET`. O
    SSO virou um `Project` de si mesmo, e suas rotas administrativas exigem `Authorization: Bearer`
    mais `Permission` para a rota pedida. Ver a seção abaixo.
13. **Tela de login do IdP.** Sem sessão, `/oauth/authorize` leva a pessoa à tela de login do front
    (`SSO_LOGIN_URL`), e não mais direto ao Google. A tela diz em qual aplicação ela está entrando e
    **só oferece provedor com um pedido pendente**, criado por uma aplicação que viu alguém sem
    sessão. Aberta direto, não oferece login nenhum. Recusa do Google, como conta não cadastrada ou
    consentimento negado, volta a ela como código, nunca como texto livre.
14. **Console do SSO.** O `plataforma_sso-v1` entra como qualquer aplicação, com a `redirect_uri`
    registrada no projeto `SSO`, e depois se autentica pela **própria sessão do SSO**, na mesma origem
    da API (RFC 10017 §7.1). Nenhum token chega ao JavaScript. Escrita exige `X-CSRF-Token` e origem
    do console. O menu sai das permissões do papel, e o que o papel não alcança não aparece.
15. **Rotas dentro do projeto, em árvore.** Saiu do menu o item que listava as rotas de todas as
    aplicações numa lista só. Elas moram na aba do projeto, agrupadas pelo caminho: `/equipment` é pai
    de `/equipment/:id`, que é pai de `/equipment/:id/create`. Todo nó abre o detalhe do caminho, com
    os métodos, os papéis que alcançam cada um, quem pode chamar e o que mora abaixo. Os papéis
    seguiram o mesmo caminho: não há tela global de papéis, e o console só busca os de um projeto.
16. **UI como pacote independente.** Componentes e Storybook saíram do contexto dos projetos:
    `@pedrolucaslopes/dotlog-ui`, repositório `components_storybook-v1`, publicado no GitHub Packages
    por tag. O console instala pelo npm, sem alias, `paths` ou contexto de build apontando para a pasta
    da biblioteca.
17. **Autenticação como pacote publicado.** `@pedrolucaslopes/sso-client` saiu do workspace npm para o
    GitHub Packages. Ganhou `forRootFromEnv()`, que lê o contrato de variáveis e lista tudo o que falta
    de uma vez, e registra o próprio `cookie-parser`. O krloc instala por versão.
18. **Repositórios separados.** SSO, console e krloc viraram `sso-api-v1`, `plataforma_sso-v1` e
    `krloc-api-v1`, cada um com o próprio `docker-compose.yml`, e as bibliotecas passaram a `sso-lib-v1` e
    `components_storybook-v1`. As aplicações chegam ao SSO por
    `host.docker.internal:8080`, sem rede compartilhada nem ordem de subida.
19. **Redirect URI se apaga, e o projeto SSO se protege.** `DELETE /sso/redirecturi/:id` tira o
    endereço de circulação na hora: o authorize deixa de aceitá-lo e o token endpoint recusa code
    emitido para ele. O projeto `SSO` não se apaga, não se renomeia e não sai de `ACTIVE`; a última
    redirect URI dele, e a da origem que pede, não saem.
20. **Catálogo dinâmico, papéis de nome livre e raiz.** Rotas, papéis e permissões moram só no banco
    do SSO. Todo projeto nasce com os quatro papéis padrão, vazios, e ganha os de nome livre que
    precisar. O `SUPERADMIN` do projeto `SSO` é a raiz, a única regra de acesso escrita no código; no
    SSO, só ela escreve. Trocar o papel de um membro e tirá-lo do projeto ganharam rota e tela.
21. **Rota negada responde 404**, no SSO e no `sso-client`, igual a caminho que não existe (RFC 9110
    §15.5.4). O `sso-client` 0.2.0 pergunta de novo ao SSO antes de negar e não guarda conjunto de
    permissões por mais de 60 segundos.
22. **Sem bootstrap no repositório.** Saíram `bootstrap-sso.js`, `register-app.js`,
    `operator-token.js` e o `sso.app.json` do krloc. Cada ambiente nasce de um SQL rodado uma vez, fora
    de todo repositório, e o SSO não sobe sem o que ele cria.
23. **Interface em três línguas.** Inglês, espanhol e português do Brasil, trocados pelo menu com o
    nome da pessoa, com bandeira. Cada front traduz com vue-i18n e um JSON por língua, e o
    `dotlog-ui` 0.2.0 traduz os próprios componentes e segue a mesma língua. Língua nova é um JSON a
    mais, sem código.
24. **Front do KRLoc.** O `plataforma_krloc-v1` é a interface da API do KRLoc, na mesma origem dela, e
    não conduz OAuth: o `sso-client` da API faz o login e o front só lê a sessão em `/api/auth/me`.
    Contratos com o ciclo inteiro, equipamentos, acessórios, clientes e obras, nas três línguas. Os
    componentes que faltavam nasceram antes na biblioteca, na 0.3.0: `DlFileDrop`, `DlMoneyField` e
    `DlLifecycle`.

25. **Revisão de segurança dos seis repositórios.** Cada um ganhou um `PENTEST.md` com escopo, método,
    achados pontuados por severidade e CVSS v3.1, evidência de como foram verificados e o que foi feito
    em cada um. O que saiu desta rodada: dependências de produção zeradas nas duas APIs (`npm audit`
    com `found 0 vulnerabilities`, com `overrides` para o que vinha preso a versão fixa), limite de
    requisições por origem, `helmet` com política fechada, teto no `limit` da paginação, política de
    conteúdo completa nos dois fronts, upload com teto no multer e conferência de tipo, e a exclusão de
    usuário que a chave estrangeira travava. Os riscos aceitos estão escritos, com a razão de cada um.
26. **O que muda no SSO chega à aplicação em até 30 segundos.** Antes, papel trocado, pessoa tirada do
    projeto, aplicação suspensa e logout só pesavam quando o access token vencia, em até 15 minutos. O
    SSO ganhou `POST /sso/oauth/introspect` (RFC 7662), e o `sso-client` 0.4.0 pergunta a ele no máximo
    uma vez por token a cada 30 segundos (`APP_GRANT_CHECK_SECONDS`), e sempre em `/auth/me` e
    `/auth/token`. Papel diferente do token: a requisição é decidida pelo papel de agora e a sessão
    recebe um token novo na mesma resposta. Grant inativo: a sessão cai. Os fronts releem `/auth/me` a
    cada 30 segundos, e na volta à aba, e o menu muda sem recarregar a página. De quebra, o logout deixou
    de ser cosmético para o access token já emitido, e dois caminhos em que a própria biblioteca
    renovava duas vezes com o mesmo refresh token, derrubando a sessão por reuso, foram fechados.
27. **Erro sai com código; o texto é do front.** Os fronts reconheciam o erro pela frase do servidor e
    mostravam crua a que não conheciam. Agora toda API responde o erro com um código estável no campo
    `error`, de um catálogo em `global/error/apiError.ts` de cada uma. A recusa da validação traz o código
    de cada campo, e o `sso-client` 0.5.0 manda `csrf_token_invalid`, `origin_not_allowed` e
    `invalid_token`. O front escolhe o texto pelo código, na língua da tela, e nunca mostra `message`.
    Junto saíram do corpo o texto interno do Prisma, o motivo exato de token recusado e valores
    repetidos da requisição (RFC 9457 §3.1.4 e §5).

Testes: `test/oauth-e2e.js` deste repositório (`npm run test:oauth`, 174 asserções, e `npx jest` para
as regras de proteção e os filtros de erro) e `test/sso-e2e.js` do `krloc-api-v1` (`npm run test:sso`,
94 asserções, e `npx jest` para o contrato de erro). As
duas suítes ponta a ponta rodam contra a stack de pé, criam o que precisam e desfazem tudo no fim,
inclusive quando quebram no meio.

### Pendente

- **Rotina de limpeza** para `AuthorizationCode` e `AuthSession` expirados.
- **Backup cifrado diário** no ambiente de deploy, com cópia no Cloud Storage. O roteiro mora fora dos
  repositórios, junto do SQL de primeira subida.

---

## 👤 Quem administra o SSO

A autorização das rotas administrativas vem de `ProjectUser` → `Role` → `Permission`, no banco.
Não existe segredo de administração em variável de ambiente, e não deve voltar a existir.

**A raiz é o `SUPERADMIN` do projeto `SSO`.** Ela alcança toda rota administrativa sem depender do
catálogo, e é a única que escreve no próprio SSO: rotas, papéis, permissões, membros, redirect URIs e
chaves dele. A primeira raiz de cada ambiente nasce do **SQL de primeira subida**, rodado uma vez por
quem tem acesso ao Postgres e guardado fora de todo repositório. Não há script, seed nem rota
equivalente, e não deve haver: clonar o código não pode dar a ninguém o caminho para administrar um
banco novo. O SSO se recusa a subir sem o projeto `SSO` ativo, um `SUPERADMIN` e a redirect URI do
console.

**Os outros papéis não trazem nada de fábrica.** Todo projeto, o `SSO` inclusive, nasce com
`SUPERADMIN`, `ADMIN`, `MANAGER` e `VIEWER` vazios. A raiz cria os papéis de gestão que quiser e marca
as rotas de cada um no console; quem tem esses papéis administra as aplicações, mas não o SSO.

Rota que o papel não alcança responde **404**, como caminho que não existe. Uma pessoa tem um papel
por projeto. Para tirar o acesso de alguém, tire a pessoa do projeto no console: no SSO o efeito é
imediato, porque o guard relê o papel a cada requisição, e os refresh tokens dela naquele projeto caem
junto. Na aplicação, em até 30 segundos, pela introspecção do `sso-client`; trocar o papel vale no
mesmo prazo, com token novo. O projeto `SSO` nunca fica sem `SUPERADMIN`: o último não troca de papel nem sai.

**O projeto `SSO` em si não se desmonta.** Ele não se apaga, não se renomeia e não sai de `ACTIVE`,
nem pela raiz. Se isso fosse possível, um clique errado tiraria a administração de todas as aplicações
do ar.

O dia a dia é pelo console, em `http://localhost:5173`.

---

## 🔑 Cadastrar uma aplicação nova

A ordem importa e é deliberadamente manual nos passos que envolvem segredo. Tudo pelo console do SSO,
com um papel que alcance essas rotas:

1. Criar o projeto. Ele nasce `PENDING`, com os quatro papéis padrão vazios, e **não** funciona ainda.
2. Cadastrar as redirect URIs e as rotas, criar os papéis de nome livre e marcar as rotas de cada um.
   O atalho "Grant all GET routes" monta um papel de leitura num clique.
3. Gerar a chave de cliente. O SSO gera o par, guarda só a metade pública e mostra a privada **uma
   única vez**. Quem alcança `POST /sso/clientkey/generate` é o catálogo que diz: conceda essa rota só
   a quem entrega chave.
4. Entregar a privada ao dono da aplicação por canal seguro. Nunca em chat, ticket, commit ou log
   de CI. Se escapar, revogue e gere outra.
5. Vincular cada pessoa que terá acesso, com o papel dela.
6. Ativar o projeto, quando tudo acima estiver conferido.

Conferência: `GET /sso/project/:id/overview` mostra num lugar só a identidade, a credencial, as
rotas, os papéis e quem tem acesso a quê.

> ⚠️ **Todo segredo mora em `.env`, nunca no código.** Os `.env` de todos os repositórios são
> ignorados pelo git. Nenhuma ferramenta deste repositório grava chave privada em disco ou a imprime
> em terminal: a geração devolve a chave uma vez, na resposta HTTP, com `Cache-Control: no-store`.
