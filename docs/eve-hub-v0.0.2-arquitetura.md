# Eve Hub — Arquitetura Técnica v0.0.2

> Documento de instruções para execução via Claude Code. Complementa (não substitui) o `dashboard-evecompany-planejamento.md` já existente — aqui está o **como construir**; lá está o **o que construir**. Escrito pra ser executável por uma IA e revisável por um humano depois.

## Sumário Executivo

O Eve Hub não compete no visual. Ele compete em ser a única "dashboard" do mercado em que cada módulo é uma integração de verdade — lê, escreve, sincroniza, falha isolado e se recupera sozinho — em vez de um card bonito plugado em dado estático. A peça central desta versão é o **Connector SDK**: uma interface única que todo módulo (Notion, Meta Ads, Google Ads, IA, o que vier depois) precisa implementar. Adicionar uma integração nova vira "escrever um adapter", não "reabrir o core".

Isso é literalmente o mesmo raciocínio por trás de cada node do n8n que você já configura todo dia — só que aqui o node vira também a tela que o time olha.

---

## 1. Princípios não-negociáveis

1. **Ports & Adapters (arquitetura hexagonal).** O núcleo (orquestração de sync, banco, IA) nunca importa o SDK do Notion, da Meta ou do Google diretamente. Ele conversa só com a interface `EveConnector`. Cada integração real é um adapter substituível.
2. **Contrato antes de código.** Todo connector declara: schema de configuração (Zod), capacidades (leitura/escrita/webhook), função de sync, função de escrita opcional, e o próprio widget visual.
3. **Falha isolada.** Um connector com token vencido ou API fora do ar nunca derruba a sincronização dos outros — cada sync roda em job próprio, com retry e backoff independentes.
4. **Tipado ponta a ponta.** TypeScript + Zod em tudo. Daqui a um ano, você (ou o próprio Claude Code numa sessão futura) confia no tipo em vez de reler o endpoint inteiro.
5. **Configuração por cima de código.** Trocar qual tabela do Notion aparece, qual cliente tá fixado num módulo, o título de um widget — tudo isso é dado no Postgres, não deploy novo.

---

## 2. Estrutura do monorepo

```
eve-hub/
├── apps/
│   ├── web/                  # Next.js (App Router) — a dashboard em si
│   └── worker/                # processo separado: fila de sync, agendamento de posts, jobs de IA
├── packages/
│   ├── core/                   # tipos de domínio, client do banco, orquestração
│   ├── connector-sdk/           # a interface EveConnector + registry
│   ├── connectors/
│   │   ├── notion/
│   │   ├── meta-ads/
│   │   ├── google-ads/
│   │   ├── instagram-insights/
│   │   ├── ga4/
│   │   ├── search-console/
│   │   ├── pagespeed/
│   │   ├── n8n-webhook/
│   │   ├── whatsapp/
│   │   ├── post-scheduler/       # Content Publishing API (Instagram/Facebook)
│   │   ├── local-files/           # atalhos pro servidor local
│   │   └── ai-module/              # feed diário + módulo IA de escopo controlado
│   └── ui/                       # design system compartilhado (tokens do protótipo v0.0.1)
├── infra/
│   ├── docker-compose.yml
│   └── prisma/schema.prisma
└── .github/workflows/ci.yml
```

Cada pasta em `connectors/` é um pacote independente, testável isoladamente, que se auto-registra ao ser importado. Adicionar um connector novo = uma pasta nova + uma linha de import. Nada no `core` precisa mudar.

---

## 3. Connector SDK — o coração do produto

```ts
// packages/connector-sdk/types.ts
import { z } from 'zod';
import type { ComponentType } from 'react';

export interface SyncResult {
  ok: boolean;
  data: unknown;              // formato livre, dono é o connector
  remoteVersion?: string;     // ex: last_edited_time do Notion — usado no lock otimista
  syncedAt: string;
  error?: string;
}

export interface WriteResult {
  ok: boolean;
  conflict?: boolean;         // true = a trava otimista rejeitou o write
  currentRemoteValue?: unknown;
}

export interface EveConnector<Config = unknown> {
  id: string;                  // 'notion' | 'meta-ads' | ...
  label: string;
  configSchema: z.ZodType<Config>;
  auth: 'oauth2' | 'api_key' | 'token' | 'webhook' | 'none';
  capabilities: { read: boolean; write: boolean; webhook: boolean };
  rateLimit?: { max: number; windowMs: number };

  sync(config: Config, lastSyncedAt: Date | null): Promise<SyncResult>;
  write?(config: Config, patch: unknown, expectedVersion: string): Promise<WriteResult>;
  onWebhook?(payload: unknown): Promise<void>;

  Widget: ComponentType<{ instanceId: string }>;
  ConfigForm: ComponentType<{ value: Config; onChange(v: Config): void }>;
}
```

`packages/connector-sdk/registry.ts` expõe `registerConnector()`. `apps/web` e `apps/worker` importam o mesmo registry — front e back nunca dessincronizam sobre "quais integrações existem".

---

## 4. Modelo de dados (Prisma)

Recomendo **Prisma** em vez de Drizzle pra essa fase: o Prisma Studio dá uma UI visual pra inspecionar/editar dados sem escrever SQL, o que importa porque quem vai revisar dado bruto no dia a dia é você — não alguém confortável escrevendo query. Prisma 7 (nov/2025) trocou o engine Rust por TS/WASM e resolveu boa parte do problema antigo de cold start, então a desvantagem histórica em serverless não pesa mais tanto pro seu caso.

```prisma
model Workspace {
  id        String   @id @default(cuid())
  name      String
  users     User[]
  connectorInstances ConnectorInstance[]
}

model User {
  id              String   @id @default(cuid())
  workspaceId     String
  workspace       Workspace @relation(fields: [workspaceId], references: [id])
  name            String
  email           String   @unique
  dashboardConfig Json     @default("{}")  // layout do grid + config por widget
}

model ConnectorInstance {
  id             String   @id @default(cuid())
  workspaceId    String
  workspace      Workspace @relation(fields: [workspaceId], references: [id])
  connectorId    String    // casa com o id do SDK: 'notion', 'meta-ads'...
  label          String
  config         Json      // validado contra o Zod schema do connector
  credentialsEnc Bytes     // token/secret cifrado (AES-256-GCM)
  status         String    @default("ok") // ok | error | syncing
  lastSyncedAt   DateTime?
  snapshots      SyncSnapshot[]
}

model SyncSnapshot {
  id                  String   @id @default(cuid())
  connectorInstanceId String
  connectorInstance   ConnectorInstance @relation(fields: [connectorInstanceId], references: [id])
  data                Json
  remoteVersion       String?
  syncedAt            DateTime @default(now())
}

model EditLog {
  id                  String   @id @default(cuid())
  connectorInstanceId String
  userId              String
  fieldPath           String
  oldValue            Json
  newValue            Json
  createdAt           DateTime @default(now())
  rolledBackAt        DateTime?
}

// Mesma lógica pra: AutomationLog, MuralPost, AiFeedLog, AiConversation —
// cada um com workspaceId + timestamps, seguindo o mesmo padrão acima.
```

`workspaceId` está em toda tabela desde já, mesmo que hoje só exista uma linha em `Workspace`. Custo zero agora, e "vender pra outra agência" vira particionamento de dado, não reescrita.

---

## 5. Sincronização e filas

- **BullMQ + Redis.** Cada `ConnectorInstance` ganha um job repetível (5–10 min, com jitter pra não sincronizar tudo no mesmo segundo).
- O job carrega o connector pelo `connectorId` no registry, chama `.sync()`, grava em `SyncSnapshot`, atualiza `lastSyncedAt`.
- `rateLimit` declarado por connector é respeitado pelo limiter da própria fila do BullMQ — importante pra não estourar cota do Meta/Google Ads.
- Retry com backoff exponencial (padrão do BullMQ), até 5 tentativas; depois disso o `ConnectorInstance.status` vira `error` e aparece sozinho no módulo de Log de Automações/Notificações — o próprio produto se audita.

---

## 6. Tempo real sem recarregar a página

Sync grava no Postgres → publica um evento leve (`connector:<id>:updated`) via Redis Pub/Sub → um endpoint SSE (`/api/events`) entrega isso pras abas abertas → o front busca só o dado daquele widget específico. Mais simples e barato que WebSocket pra ≤20 usuários simultâneos; dá pra trocar por Socket.io depois sem tocar em nenhum connector, já que eles não sabem nem precisam saber como o dado chega até a tela.

---

## 7. Edição bidirecional (Notion) — fluxo exato

1. Widget carrega `SyncSnapshot.data` + `remoteVersion` (o `last_edited_time` que o Notion devolve).
2. Usuário clica no lápis, edita inline.
3. Salvar dispara `POST /api/connectors/notion/write { instanceId, patch, expectedVersion }`.
4. O `write()` do connector:
   - busca o `last_edited_time` atual direto no Notion;
   - bate com `expectedVersion`? faz o `PATCH`, grava `EditLog`, retorna `{ ok: true }`;
   - não bate? alguém mexeu antes → retorna `{ ok:false, conflict:true, currentRemoteValue }` → tela avisa "esse dado mudou, recarregue".
5. **Desfazer** (visível por 10 min, calculado a partir de `EditLog.createdAt`) reaplica `oldValue` passando pelo **mesmo** `write()` — ou seja, o próprio undo respeita a trava otimista. Sem caminho especial "forçar escrita".

---

## 8. Camada de IA

- `AiProvider`: interface que abstrai a chamada ao modelo, pra poder usar um modelo mais barato/rápido no feed diário e um mais robusto no módulo de escopo, sem tocar em quem chama.
- **Feed diário:** disparado no login do usuário (não em horário fixo — sem gente logada, sem chamada). Calcula delta por `SyncSnapshot` desde a última visita, manda pro modelo com um prompt fixo de "resuma priorizando quedas/erros/oportunidades", cacheia em `AiFeedLog` (uma entrada por usuário por dia).
- **Módulo IA:** usuário seleciona 1+ `SyncSnapshot`s como escopo, escolhe uma skill, manda junto com a pergunta livre. As skills continuam vivendo no seu projeto separado — o Eve Hub é **cliente** delas (chama por ID/contrato estável), nunca reimplementa a lógica da skill dentro do hub. Log de cada conversa fica em `AiConversation`, amarrado ao `ConnectorInstance`/cliente em questão — isso é o embrião do "second brain" que já estava no backlog.

---

## 9. Segurança e auditoria

- `credentialsEnc` sempre cifrado (AES-256-GCM), chave via variável de ambiente, nunca logado, nunca exposto ao front.
- Webhooks do n8n verificados por header de segredo compartilhado (`X-Eve-Webhook-Secret`) — payload sem assinatura é descartado.
- Vocês decidiram não ter modelo de permissões — tudo bem, mas isso só é seguro se **toda escrita for auditável**: todo `EditLog` carrega `userId`. Liberdade total de uso, zero anonimato sobre quem mudou o quê.

---

## 10. Grid de widgets (front)

- `react-grid-layout` pro drag/resize — persiste o layout direto em `User.dashboardConfig`.
- Cada `Widget` de connector carrega via `next/dynamic` (lazy) — um connector lento ou quebrado nunca trava o resto da tela renderizando.
- O design system (`packages/ui`) fornece a casca comum de todo módulo — cabeçalho com seta/lápis/3-pontinhos, cores, tipografia — reaproveitando os tokens já validados no protótipo v0.0.1 (ink/âmbar/teal, Space Grotesk + Inter). O miolo de cada widget é livre pro connector desenhar como quiser.

---

## 11. DevOps e convenções

- `docker-compose.yml` local: postgres, redis, web, worker — `docker compose up` e tá rodando.
- CI (GitHub Actions) em todo PR: lint, typecheck, testes unitários por connector (cada um mocka sua própria API externa e testa isolado).
- Migrations do Prisma versionadas no repo — schema de produção nunca editado na mão.
- Commits no padrão Conventional Commits; branches `feat/connector-notion`, `fix/sync-retry`, etc.

---

## 12. Por que isso não é "mais um CRM vazio"

- Cada módulo lê **e escreve** de verdade — não é iframe nem card estático.
- IA com escopo controlado por design: nunca manda a base inteira pro modelo, só o que o usuário escolheu. Isso é argumento de segurança pra qualquer cliente preocupado com dado sensível.
- Self-hosted por padrão: o dado do cliente da agência fica na infra da agência, não numa SaaS terceira — ponto sensível pra qualquer contrato de confidencialidade que vocês já assinam.
- Arquitetura de connector plugável significa que uma integração nova é dias, não um pedido no roadmap de um fornecedor.
- Nasce já pensado pra virar produto (workspace desde o dia 1), sem ter sido desenhado como produto — é operação real da EveCompany rodando, o que é a prova de conceito mais forte que existe.

---

## 13. Escopo do v0.0.2 (o que entra AGORA)

Pra ter algo real e demonstrável já na próxima sessão, o v0.0.2 entrega só isto — o resto do backlog (WhatsApp, agendador de posts, mural, feed com IA, PageSpeed, etc.) fica documentado no `dashboard-evecompany-planejamento.md` pra entrar em v0.0.3+:

1. Monorepo + `connector-sdk` + registry funcionando
2. Schema Prisma completo + `docker compose up` local
3. Autenticação simples (sem RBAC)
4. Connector **Notion**: leitura completa + escrita com lock otimista + undo de 10 min
5. Connector **Meta Ads**: leitura (saldo, CTR)
6. Connector **Google Ads**: leitura (saldo)
7. Worker de sync rodando os três acima a cada 5–10 min
8. Grid de widgets com seta/lápis/3-pontinhos funcionando de verdade (não só visual)

Isso já prova o argumento central do produto — leitura multi-fonte + escrita real com trava de conflito — sem prometer o backlog inteiro de uma vez.

---

## 14. Nota sobre o connector de WhatsApp (pra quando chegar a vez dele)

A API oficial (WhatsApp Business Platform / Cloud API) não permite "puxar" histórico de conversa como as outras — ela entrega mensagem por mensagem via webhook, em tempo real. Isso significa que o `onWebhook()` desse connector precisa **construir e manter seu próprio histórico** (tabela própria de mensagens) a partir dos eventos que chegam, em vez de um `sync()` tradicional que busca dado existente. Vale registrar isso agora pra ninguém se surpreender quando chegar nesse connector.

---

## 15. Como usar este arquivo com o Claude Code

Cole este documento como referência inicial e peça pra seguir a ordem das seções 2 → 3 → 4 → 5 → 7 → 10, validando cada item da lista da Seção 13 antes de avançar pro próximo. Peça pra ele já criar os arquivos de teste unitário junto com cada connector (Seção 11), não depois.
