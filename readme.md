# Eve Hub

Central de visualizacao e acao da EveCompany. Cada modulo da dashboard e uma
integracao de verdade — le, escreve, sincroniza, falha isolado e se recupera
sozinho — em vez de um card bonito plugado em dado estatico.

**Versao atual: v0.0.3** — fundacao completa (monorepo, Connector SDK, banco,
autenticacao, grid de widgets) com um connector de demonstracao no lugar das
integracoes reais. Notion, Meta Ads e Google Ads entram em v0.0.4.

## A dashboard

Em `/` a dashboard e um **board livre** (canvas): modulo em qualquer lugar, o
mesmo modulo quantas vezes quiser, texto e imagem soltos no board. Botao
direito abre o menu de adicionar / travar / duplicar / remover; ligar dois
modulos cria uma **tela** — um grupo com nome, que o Ctrl+K encontra e para
onde ele leva a visao do board.

Atalhos: `Ctrl+K` busca tudo (paginas, cada configuracao, modulos, telas),
`Ctrl+Z`/`Ctrl+Shift+Z` desfaz/refaz, `Ctrl+D` duplica, `Ctrl+1` enquadra,
`Ctrl+0` volta pra 100%, `Del` remove, `Ctrl+wheel` (ou pinca) da zoom,
espaco+arrastar (ou botao do meio) da pan.

A grade de 12 colunas continua existindo: **Configuracoes > Layout > Modo da
dashboard**. Cada modo guarda o seu proprio arranjo, entao trocar nao apaga
nada.

## Documentos

| Arquivo | Conteudo |
|---|---|
| [`dashboard-evecompany-planejamento.md`](dashboard-evecompany-planejamento.md) | **O que** construir — backlog completo do produto |
| [`eve-hub-v0.0.2-arquitetura.md`](eve-hub-v0.0.2-arquitetura.md) | **Como** construir — principios de arquitetura |
| [`eve-hub-v0.0.3-escopo.md`](eve-hub-v0.0.3-escopo.md) | Escopo desta versao + correcoes ao modelo de dados |

---

## Rodando localmente

Pre-requisitos: Node 22+, Docker e pnpm (`npm i -g pnpm`).

```bash
cp .env.example .env

# Gere as duas chaves e cole no .env:
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"  # CREDENTIALS_KEY
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"  # AUTH_SECRET

pnpm install
pnpm services:up      # sobe postgres + redis
pnpm db:generate      # gera o Prisma Client (nao vai versionado)
pnpm db:migrate       # aplica as migrations
pnpm db:seed          # cria workspace, owner e um widget de demo

pnpm dev              # web em http://localhost:3000 + worker
```

Entre com o `SEED_OWNER_EMAIL` / `SEED_OWNER_PASSWORD` do seu `.env`.

> `postgres` e `redis` rodam em container; `web` e `worker` rodam nativos, porque
> o file-watching do Next dentro de container no Windows e lento. Para subir tudo
> containerizado como em producao: `pnpm stack:up`.

### Google OAuth (opcional)

Sem `AUTH_GOOGLE_ID`/`AUTH_GOOGLE_SECRET` a tela de login simplesmente nao mostra
o botao do Google. Para ligar, crie um OAuth client Web no Google Cloud com o
redirect `http://localhost:3000/api/auth/callback/google`. Só entram e-mails do
dominio em `ALLOWED_EMAIL_DOMAIN`.

### Google Ads (opcional)

Nada vai pro `.env`: as credenciais sao por conta conectada, cifradas no banco
como as dos outros connectors. Antes de conectar, junte quatro coisas:

| O que | Onde |
|---|---|
| Developer token | API Center da conta de gerenciamento (MCC) do Google Ads. Enquanto o acesso for *test*, ele so le contas de teste. |
| OAuth client ID + secret | Google Cloud > APIs e servicos > Credenciais, no mesmo projeto. |
| Refresh token | OAuth Playground com o escopo `https://www.googleapis.com/auth/adwords`, usando o seu proprio client ID/secret. |
| ID da conta | Os 10 digitos no topo da conta (com ou sem tracos). Se voce entra por uma MCC, informe tambem o ID dela. |

O connector e **somente leitura** de proposito: mexer em campanha ativa a
partir de uma dashboard e mais arriscado do que ler uma. A versao da API fica
fixada em `GOOGLE_ADS_API_VERSION` (`packages/connectors/google-ads/src/shared.ts`);
quando o Google aposentar a versao, a sync passa a dizer exatamente isso.

## Scripts

| Comando | O que faz |
|---|---|
| `pnpm dev` | web + worker em modo watch |
| `pnpm build` | build de producao |
| `pnpm test` | Vitest em todo o monorepo |
| `pnpm typecheck` | `tsc --noEmit` em todos os pacotes |
| `pnpm lint` | ESLint na raiz |
| `pnpm db:studio` | Prisma Studio para inspecionar/editar dado bruto |
| `pnpm services:up` / `services:down` | postgres + redis |
| `pnpm stack:up` | tudo em container (profile `full`) |

---

## Estrutura

```
apps/
  web/          Next.js (App Router) — dashboard, API, autenticacao
  worker/       processo separado — fila BullMQ de sync e retencao
packages/
  connector-sdk/   a interface EveConnector + registry
  core/            banco, cifra, eventos, orquestracao de sync e escrita
  ui/              design system (tokens do prototipo v0.0.1) + strings pt-BR
  connectors/
    demo/          connector de referencia, sem credenciais
infra/
  prisma/       schema, migrations, seed
  Dockerfile.*  imagens de web e worker
```

### Escrevendo um connector novo

1. `packages/connectors/<nome>/` com `src/connector.ts` (runtime, servidor) e
   `src/shared.ts` (constantes seguras para o browser).
2. Implemente `EveConnector` e chame `registerConnector()`. O registry cobra no
   import: declarou `write`, tem que ter `write()` **e** `readVersion()`.
3. Registre o widget em `apps/web/src/widgets/registry.tsx` — **opcional**: sem
   entrada la, o connector ja renderiza pelo widget generico, guiado pelo
   `describeFields()`.
4. Importe o pacote em `apps/web/src/connectors.ts` e em `apps/worker/src/index.ts`,
   e declare a dependencia `workspace:*` nos `package.json` das duas apps.
5. Se ele pede credencial, descreva os campos em `SETUP_FIELDS`
   (`apps/web/src/components/ConnectorSetup.tsx`) com os textos em
   `packages/ui/src/strings.ts`.
6. Adicione o `COPY` do `package.json` do pacote em `infra/Dockerfile.web` e
   `infra/Dockerfile.worker` — o build de producao instala a partir dessa lista.

`apps/web/src/connectors.test.ts` cobra os passos 4 e 6 na hora: esquecer um
deles quebra o teste em vez de sumir com o connector em silencio.

Nada no `core` muda. Use `packages/connectors/demo` como referencia — ele
implementa o contrato inteiro, incluindo conflito e undo.

---

## Decisoes que valem saber

- **Widget nao e parte do `EveConnector`.** O worker importa connectors para
  rodar sync e nunca pode puxar React para dentro de um processo Node. As duas
  metades sao ligadas pelo mesmo `id`.
- **`@eve/core` e servidor.** Componentes client importam `@eve/core/dashboard`,
  que so tem Zod e funcoes puras. Importar o barrel no browser arrastaria
  Prisma, argon2 e ioredis para o bundle.
- **A trava otimista e por registro** (`SyncRecord.remoteVersion`), nao por
  tabela — senao editar a linha A entraria em conflito com quem mexeu na B.
- **Undo rele a versao atual antes de reverter.** Sem isso ele mandaria a versao
  de antes da propria edicao e conflitaria 100% das vezes. Nao existe caminho
  "forcar escrita".
- **Sem RBAC, com uma excecao:** `User.isOwner` controla credenciais de connector
  e exclusao de instancia. Toda a regra vive em `apps/web/src/lib/permissions.ts`.
- **pnpm fixado em 10.x** no campo `packageManager`. O 12.3.4 cria symlinks
  quebrados na raiz para pacotes com peer dependencies (`eslint`,
  `@prisma/client`). Nao atualize sem testar `node node_modules/eslint/bin/eslint.js -v`.
- **TypeScript 6.x**, um major atras do 7 (o port nativo), enquanto o ecossistema
  de plugins alcanca.

## Problemas comuns

**O login fica preso em "Entrando..."**
Nao deveria mais acontecer — se acontecer, e bug, nao configuracao. O que costuma
estar por tras e postgres/redis parados; nesse caso a tela agora responde em
milissegundos com uma mensagem clara em vez de travar:

```bash
docker compose ps        # os dois precisam aparecer "healthy"
pnpm services:up         # sobe postgres + redis
```

- **Redis parado:** o login continua funcionando, so sem rate limit (degrada, nao
  trava). O log mostra `[rate-limit] Redis indisponivel, permitindo a tentativa`.
- **Postgres parado:** a tela diz "Servico indisponivel", nao "senha incorreta" —
  a diferenca importa para nao perder tempo cacando um erro de digitacao.

Todo cliente Redis no caminho de request usa `enableOfflineQueue: false` mais um
timeout. Com a fila padrao do ioredis, um comando emitido enquanto a conexao esta
caida fica bufferizado e a promise **nunca resolve** — foi exatamente assim que o
login travou uma vez.

**`pnpm lint` reclama que nao acha o eslint**
Sintoma de symlink quebrado do pnpm. Rode
`node node_modules/eslint/bin/eslint.js -v`; se falhar, apague `node_modules` e
reinstale. Nao suba o pnpm para 12.x (ver decisoes acima).

## Limites conhecidos (v0.0.3)

- Escrita cobre campos de primeiro nivel do registro. Caminhos aninhados chegam
  com o connector do Notion.
- Cada aba aberta mantem uma conexao SSE. Um subscriber Redis por processo ja
  resolve o custo no servidor; acima de ~100 abas simultaneas vale reavaliar.
- O seletor global de cliente esta plumbado (`ClientProvider`) mas vazio — entra
  quando existirem clientes reais para selecionar.
