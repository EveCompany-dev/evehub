# Eve Hub — Escopo Técnico v0.0.3

> Primeira versão **executável** do projeto. A v0.0.2 é um documento de arquitetura; nada foi codado ainda.
> Esta versão entrega a fundação: monorepo, SDK de connector, banco, autenticação e o grid de widgets
> funcionando ponta a ponta — com um connector de demonstração no lugar das integrações reais.
> Complementa `eve-hub-v0.0.2-arquitetura.md` (o *como*) e `dashboard-evecompany-planejamento.md` (o *o quê*).

## Decisões fechadas nesta versão

| Tema | Decisão |
|---|---|
| Escopo | Fundação + connector `demo` in-tree. Notion/Meta/Google Ads ficam pra v0.0.4. |
| Login | Auth.js v5 com **dois** providers: Google (restrito a `@evecompany.com.br`) **e** e-mail/senha. Sem auto-cadastro público. |
| Permissões | Sem RBAC, como planejado — com **uma** exceção: `User.isOwner` controla quem pode criar/editar/apagar credenciais de connector. |
| Idioma | Código, tabelas, commits e comentários em **inglês**. Toda string visível em **pt-BR**, centralizada em `packages/ui/strings.ts` (pronta pra `next-intl` depois, sem i18n agora). |
| Gerenciador | pnpm workspaces + Turborepo. |
| ORM | Prisma (mantida a decisão da v0.0.2). |

---

## 1. Por que um connector `demo`

A v0.0.2 planejava validar o SDK direto contra Notion/Meta/Google. O problema: o SDK e o seu
primeiro consumidor seriam desenhados ao mesmo tempo, sem nada pra provar que a abstração fecha —
e nada roda sem credencial de produção na mão.

O connector `demo` gera dados falsos determinísticos e implementa **toda** a interface `EveConnector`:
`sync()`, `write()` com trava otimista e `readVersion()` — mais o widget correspondente. Com isso:

- o worker, a fila, o SSE, o grid, o undo e o CI rodam de verdade sem nenhum token;
- ele vira a implementação de referência que o connector do Notion copia na v0.0.4;
- os testes de integração do core não dependem de rede nem de mock de API externa.

Custo: uma pasta. Ele fica no repo permanentemente como fixture de teste.

---

## 2. Correções ao modelo de dados da v0.0.2

Seis pontos da v0.0.2 não fecham como escritos. Corrigidos aqui **antes** da primeira migration:

### 2.1 `remoteVersion` precisa ser por registro, não por snapshot

A v0.0.2 põe um único `remoteVersion` no `SyncSnapshot`. Mas o `last_edited_time` do Notion é **por
página** (por linha da tabela), não por database. Com um único valor, editar a linha A entraria em
conflito com quem mexeu na linha B — a trava otimista, que é o argumento central do produto, não
funcionaria.

**Correção:** tabela `SyncRecord`, uma linha por objeto remoto, com `remoteId` + `remoteVersion`
próprios. O `SyncSnapshot` continua existindo como fotografia bruta da resposta (útil pra debug,
pro delta do feed de IA e pra connectors sem noção de "registro"), mas quem manda na escrita é o
`SyncRecord`.

### 2.2 O undo sempre conflitaria

Seção 7, passo 5 da v0.0.2: o desfazer reaplica `oldValue` passando pelo mesmo `write()`. Correto em
espírito, mas ele mandaria o `expectedVersion` do momento da edição — que por definição já mudou,
já que a própria edição original o alterou. Resultado: 100% de conflito.

**Correção:** o undo faz um re-fetch da versão remota atual e usa **essa** como `expectedVersion`.
Continua sem caminho "forçar escrita": se alguém editou depois de você, o undo é rejeitado com
conflito, que é o comportamento certo.

### 2.3 `SyncSnapshot` cresce sem limite

Uma linha por instância a cada 5–10 min ≈ 8.600 linhas/instância/mês, e toda leitura de widget vira
`order by syncedAt desc limit 1`.

**Correção:** `ConnectorInstance.latestSnapshotId` aponta direto pro snapshot corrente (leitura O(1))
e um job de retenção no worker apaga snapshots com mais de 30 dias, preservando sempre o mais recente.

### 2.4 Faltam as tabelas de autenticação

O schema da v0.0.2 não tem `Account`, `Session` nem `VerificationToken` — obrigatórias pro Auth.js
com adapter Prisma.

### 2.5 Falta `User.lastSeenAt`

O feed diário de IA inteiro depende de "delta desde a última vez que o usuário esteve online". O
campo não existia. Adicionado agora (custo zero) mesmo com a feature só chegando em v0.0.6.

### 2.6 `credentialsEnc` sem versão de chave

AES-256-GCM com chave em env é o certo, mas sem `credentialsKeyVersion` é impossível rotacionar a
chave sem decifrar tudo num único big-bang.

**Bônus:** `ConnectorInstance.status` vira `enum`, e `workspaceId` entra explicitamente em `EditLog`
e `AutomationLog` (a v0.0.2 dizia "mesma lógica" mas não escrevia).

---

## 3. Schema Prisma desta versão

```prisma
enum ConnectorStatus { ok syncing error disabled }

model Workspace {
  id                 String   @id @default(cuid())
  name               String
  createdAt          DateTime @default(now())
  users              User[]
  connectorInstances ConnectorInstance[]
  editLogs           EditLog[]
  automationLogs     AutomationLog[]
}

model User {
  id              String    @id @default(cuid())
  workspaceId     String
  workspace       Workspace @relation(fields: [workspaceId], references: [id])
  name            String?
  email           String    @unique
  emailVerified   DateTime?
  image           String?
  passwordHash    String?                      // null = só entra por Google
  isOwner         Boolean   @default(false)    // única distinção de permissão: gerencia credenciais
  lastSeenAt      DateTime?                    // base do delta do feed diário (v0.0.6)
  dashboardConfig Json      @default("{}")     // layout do grid + config por widget
  createdAt       DateTime  @default(now())
  accounts        Account[]
  sessions        Session[]
  editLogs        EditLog[]
  @@index([workspaceId])
}

// Account / Session / VerificationToken: shape padrão do @auth/prisma-adapter.

model ConnectorInstance {
  id                    String          @id @default(cuid())
  workspaceId           String
  workspace             Workspace       @relation(fields: [workspaceId], references: [id])
  connectorId           String          // casa com EveConnector.id: 'demo', 'notion', ...
  label                 String
  config                Json            // validado contra o Zod schema do connector
  credentialsEnc        Bytes?          // AES-256-GCM; null enquanto não configurado
  credentialsKeyVersion Int             @default(1)
  status                ConnectorStatus @default(ok)
  statusMessage         String?         // último erro legível, exibido no widget
  lastSyncedAt          DateTime?
  latestSnapshotId      String?         @unique
  createdAt             DateTime        @default(now())
  snapshots             SyncSnapshot[]
  records               SyncRecord[]
  editLogs              EditLog[]
  @@index([workspaceId, connectorId])
}

model SyncSnapshot {
  id                  String   @id @default(cuid())
  connectorInstanceId String
  connectorInstance   ConnectorInstance @relation(fields: [connectorInstanceId], references: [id], onDelete: Cascade)
  data                Json
  syncedAt            DateTime @default(now())
  @@index([connectorInstanceId, syncedAt])
}

model SyncRecord {
  id                  String   @id @default(cuid())
  connectorInstanceId String
  connectorInstance   ConnectorInstance @relation(fields: [connectorInstanceId], references: [id], onDelete: Cascade)
  remoteId            String   // id do objeto na fonte (page id do Notion, etc.)
  remoteVersion       String   // last_edited_time & cia — a trava otimista mora aqui
  data                Json
  syncedAt            DateTime @default(now())
  @@unique([connectorInstanceId, remoteId])
}

model EditLog {
  id                  String    @id @default(cuid())
  workspaceId         String
  workspace           Workspace @relation(fields: [workspaceId], references: [id])
  connectorInstanceId String
  connectorInstance   ConnectorInstance @relation(fields: [connectorInstanceId], references: [id])
  userId              String
  user                User      @relation(fields: [userId], references: [id])
  remoteId            String
  fieldPath           String
  oldValue            Json
  newValue            Json
  createdAt           DateTime  @default(now())
  rolledBackAt        DateTime?
  @@index([connectorInstanceId, createdAt])
}

model AutomationLog {
  id          String    @id @default(cuid())
  workspaceId String
  workspace   Workspace @relation(fields: [workspaceId], references: [id])
  source      String    // 'n8n', ...
  event       String
  payload     Json
  ok          Boolean   @default(true)
  createdAt   DateTime  @default(now())
  @@index([workspaceId, createdAt])
}
```

`AiFeedLog`, `AiConversation` e `MuralPost` **não** entram agora — tabela vazia sem consumidor é
dívida, não preparo. Entram junto com suas features.

---

## 4. Autenticação

- **Auth.js v5** (`next-auth@5`) + `@auth/prisma-adapter`, estratégia de sessão em banco.
- **Google provider:** o callback de `signIn` rejeita qualquer e-mail fora de `@evecompany.com.br`
  (domínio configurável por env `ALLOWED_EMAIL_DOMAIN`).
- **Credentials provider:** senha com `argon2id`. Sem auto-cadastro: o usuário precisa já existir
  (criado pelo seed ou por convite de um owner). Senha errada e usuário inexistente devolvem a mesma
  mensagem e o mesmo tempo de resposta.
- Rate limit de 5 tentativas por e-mail/IP em janela de 15 min (em Redis, que já sobe no compose).
- Usuário que entra pelo Google e ainda não existe é auto-provisionado no único `Workspace`, com
  `isOwner = false`.
- `seed.ts` cria o workspace "EveCompany" e o primeiro owner a partir de `SEED_OWNER_EMAIL` /
  `SEED_OWNER_PASSWORD`.
- **Sem middleware.** O guard roda no layout/página (server component) e em cada rota de API via
  `requireUser()`. Middleware rodaria no edge, onde não há acesso ao banco — seria uma segunda
  cópia da lógica de sessão para manter em sincronia. Toda escrita em credencial checa `isOwner`
  **no servidor** (esconder o botão no front não é controle de acesso); a regra inteira vive em
  `apps/web/src/lib/permissions.ts`, com teste unitário.

---

## 5. Shell da dashboard

- `react-grid-layout` com drag/resize, layout persistido em `User.dashboardConfig` (debounce de 500ms).
- Casca de widget única em `packages/ui`: cabeçalho com título, **pill de status do connector**,
  `atualizado há X min`, e o menu de 3-pontinhos (configurar / remover / exportar). Os tokens do
  protótipo v0.0.1 viram variáveis CSS de verdade; dark/light por usuário, respeitando
  `prefers-color-scheme` na primeira visita.
- **Command palette (Ctrl+K)** — só a casca nesta versão, com navegação e "adicionar widget". É onde
  a busca global, o seletor global de cliente e os atalhos de teclado do backlog vão morar; a casca
  agora torna os três quase de graça depois.
- **Contexto de cliente** plumbado desde já (provider + `clientOverride` por widget no
  `dashboardConfig`), mesmo vazio. Retrofitar isso depois de 10 connectors seria caro.
- Cada `Widget` carrega por `next/dynamic` — connector lento ou quebrado não trava a tela.

---

## 6. Sync, filas e tempo real

- BullMQ + Redis; um job repetível por `ConnectorInstance`, 5–10 min com jitter.
- Retry exponencial (5 tentativas) → `status = error` + `statusMessage`, visível na hora no widget.
- `rateLimit` declarado pelo connector aplicado pelo limiter da fila.
- SSE em `/api/events` (runtime Node, **não** edge) alimentado por Redis Pub/Sub; o front refaz o
  fetch só do widget afetado.
- Job de retenção diário limpando `SyncSnapshot` com mais de 30 dias.

---

## 7. Testes e CI

- Vitest. Cada connector testa isolado, mockando sua própria API.
- O connector `demo` sustenta os testes de integração do core: sync → snapshot → SSE → write →
  conflito → undo, sem rede.
- GitHub Actions em todo PR: `lint`, `typecheck`, `test`, `prisma validate`.
- Conventional Commits; branches `feat/`, `fix/`, `chore/`.

---

## 8. Checklist de aceite da v0.0.3

- [x] `pnpm install` + `docker compose up` sobe postgres, redis, web e worker
- [x] `pnpm db:migrate` + `pnpm db:seed` cria workspace + owner
- [x] Login por Google (domínio restrito) e por e-mail/senha funcionando
- [x] Não-owner não consegue criar/editar credencial — bloqueado no servidor, com teste
- [x] `connector-sdk` + registry compartilhados por `web` e `worker`
- [x] Connector `demo` implementa a interface inteira e se auto-registra
- [x] Worker sincroniza o `demo` no intervalo e grava snapshot + records
- [x] Widget atualiza sozinho via SSE, sem reload
- [x] Escrita no `demo` com trava otimista: conflito devolve aviso, não sobrescreve
- [x] Undo visível por 10 min, passando pelo mesmo `write()`, com re-fetch de versão
- [x] Grid com drag/resize persistido por usuário; dark/light
- [x] Ctrl+K abre a paleta
- [x] CI verde

---

## 8.1 Desvios da v0.0.2 encontrados durante a implementação

Quatro coisas mudaram em relação ao documento de arquitetura, todas por motivo concreto:

1. **`Widget` e `ConfigForm` saíram da interface `EveConnector`.** A v0.0.2 os colocava dentro do
   contrato, mas o worker importa connectors para rodar sync e não pode puxar React para dentro de
   um processo Node. O registry de runtime (`@eve/connector-sdk`) e o registry visual
   (`apps/web/src/widgets/registry.tsx`) são ligados pelo mesmo `id`.
2. **Cada connector expõe `./shared`.** O widget roda no browser e não pode importar o módulo de
   runtime (que traz cliente Redis/HTTP e manuseio de segredo). Constantes e tipos que a interface
   precisa ficam num entry separado, seguro para o bundle do cliente.
3. **`@eve/core` ganhou o entry `./dashboard`.** Componentes client importam de lá; importar o
   barrel do core no browser arrastava Prisma, argon2 e ioredis para o bundle — o build falhou
   exatamente assim até a separação.
4. **O registry aceita registro duplicado do mesmo connector.** Bundlers avaliam o mesmo módulo uma
   vez por chunk, produzindo dois objetos distintos que descrevem o mesmo connector. A comparação é
   por conteúdo declarado (id, label, auth, capabilities), não por identidade de objeto — dois
   connectors *de verdade* com o mesmo id continuam sendo erro.

Também fixamos **pnpm 10.x** no `packageManager`: o 12.3.4 cria symlink quebrado na raiz para
pacotes com peer dependencies (`eslint`, `@prisma/client` caíram nisso).

---

## 9. Depois desta versão

- **v0.0.4** — connector Notion (leitura + escrita real + undo), agora contra um SDK já provado.
- **v0.0.5** — Meta Ads e Google Ads (leitura), webhook receiver do n8n + log de automações.
- **v0.0.6** — feed diário com IA (`AiFeedLog`, `User.lastSeenAt` já prontos) e módulo IA de escopo controlado.
- Backlog completo segue em `dashboard-evecompany-planejamento.md`.
