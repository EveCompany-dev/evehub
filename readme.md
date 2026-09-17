# Eve Hub

Central de visualizacao e acao da EveCompany. Cada modulo da dashboard e uma
integracao de verdade — le, escreve, sincroniza, falha isolado e se recupera
sozinho — em vez de um card bonito plugado em dado estatico.

**Versao atual: v0.0.3** — fundacao completa (monorepo, Connector SDK, banco,
autenticacao, grid de widgets) com um connector de demonstracao no lugar das
integracoes reais. Notion, Meta Ads e Google Ads entram em v0.0.4.

## A dashboard

Em `/` a dashboard e uma grade de 12 colunas: cada modulo e um tile que pode
ser arrastado, redimensionado e travado. Botao direito (ou o Ctrl+K) adiciona
um modulo novo.

Atalhos: `Ctrl+K` busca tudo (paginas, cada configuracao, modulos).

(Um board livre estilo canvas — modulo em qualquer lugar, ligar dois modulos
numa "tela" nomeada — foi tentado e removido: a camada de interacao nunca foi
validada de verdade num browser antes de ir pro ar, e quebrou coisas em
producao. A grade e o unico modo de dashboard agora.)

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
3. Registre o widget em `apps/web/src/widgets/registry.tsx`.
4. Importe o pacote em `apps/web/src/connectors.ts` e em `apps/worker/src/index.ts`.

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
