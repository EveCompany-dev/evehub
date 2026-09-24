# Eve Hub

O lugar onde o time da EveCompany trabalha: clientes, conteúdo, posts
agendados no Instagram e no Facebook, agenda, jobs, tarefas e conversas numa
tela só, em vez de pular entre Notion, mLabs, Business Suite e planilhas.

Cada módulo é uma integração de verdade: lê, escreve, sincroniza, e quando uma
fonte cai (um token vencido, uma API fora do ar) só aquele módulo avisa. O
resto continua funcionando.

**Versão 0.1.0**, em uso diário. O que mudou em cada versão está no
[CHANGELOG](CHANGELOG.md).

---

## O que dá para fazer

**Início.** Uma grade de módulos que cada pessoa monta do seu jeito: arraste,
redimensione, trave com o cadeado. Botão direito no fundo adiciona um módulo;
o ⋮ de cada um abre as configurações dele. Tem Resumo do dia, Tarefas, Notas,
Timer com Pomodoro, Calculadora, Calendário e o assistente (Claude).

**Clientes.** Cada cliente tem a sua página: cadastro (razão social, CNPJ,
endereço), marca e logo, jobs, arquivos e o **Calendário de Conteúdo**. Cada
linha do calendário é um conteúdo, da ideia ao post publicado. Clique com o
botão direito num dia para agendar um post ali mesmo; o Status da linha anda
sozinho: *Programado* ao agendar, *Publicado* quando o Meta confirma (com o
link), *Falhou* se algo der errado. O roteiro abre em modo teleprompter.

**Agendar Post** (no menu Tools). Instagram (feed, carrossel, story, reel) e
Facebook (feed, story), para vários destinos de uma vez. Vários arquivos
perguntam "carrossel ou posts separados?". Posts que não saíram ficam listados
no topo.

**Agenda do Time.** O Google Agenda da empresa, com todas as agendas marcadas
na conta e filtros por agenda, cliente e pessoa. Criar, editar ou apagar aqui
grava no Google. Marcar pessoas num evento é só uma etiqueta: ninguém recebe
convite. Evento particular aparece como "Ocupado".

**Jobs.** Quadro kanban com tarefas, comentários, anexos, colaboradores e
apontamento de horas. O timer flutuante acompanha você pelo app.

**Tarefas.** Listas pessoais, rápidas de digitar. `@` menciona um job, cliente
ou pessoa; `/` linka uma página. O assistente também consegue criar e marcar
tarefas.

**E mais:** Tabelas (com importação de CSV/zip do Notion, galeria, calendário
e webhook de entrada), Chat do time e mensagens privadas, Financeiro,
Automações (webhook do n8n), Notificações.

`Ctrl+K` busca qualquer coisa: páginas, configurações, módulos.

## Quem vê o quê

- **Admins** são uma lista fixa de e-mails no código
  ([`packages/core/src/admins.ts`](packages/core/src/admins.ts)). Só admins
  cadastram e removem pessoas, criam cargos, conectam integrações do time,
  apagam clientes e veem o **Registro de atividades**.
- **Só entra quem um admin cadastrou** em Equipe. O login com Google da
  empresa não cria conta sozinho.
- **Cargos só tiram abas.** Sem cargo, a pessoa vê tudo (menos o registro de
  atividades). Um cargo diz quais abas ficam liberadas.
- **Esqueci minha senha** avisa os admins; um deles gera um link de uso único
  (24 h) em Equipe e entrega à pessoa.
- **Arquivos enviados** (anexos, fotos, logos) só abrem para quem está logado.
  A exceção é a mídia de post agendado, que o Meta precisa baixar.
- **Registro de atividades:** tudo o que muda algo do time fica registrado.
  Conversa privada, chat com o assistente e preferência pessoal nunca.

---

## Rodando na sua máquina

Você precisa de **Node 22+**, **Docker** e **pnpm 10** (`corepack enable`
ativa a versão certa sozinho).

```bash
cp .env.example .env
# Gere duas chaves e cole no .env, uma em CREDENTIALS_KEY e outra em AUTH_SECRET:
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
# Preencha POSTGRES_PASSWORD, POSTGRES_APP_PASSWORD e REDIS_PASSWORD (sem elas
# o docker compose nao sobe) e repita as de Postgres e Redis em DATABASE_URL
# e REDIS_URL. Valores sem simbolos: openssl rand -hex 32

pnpm install
pnpm services:up      # Postgres e Redis em containers
pnpm db:generate      # gera o cliente do banco
pnpm db:migrate       # cria as tabelas
pnpm db:seed          # cria o workspace, o primeiro admin e um módulo de exemplo

pnpm dev              # app em http://localhost:3000, mais o worker
```

Entre com o `SEED_OWNER_EMAIL` e a `SEED_OWNER_PASSWORD` do seu `.env`. O seed
recusa a senha de exemplo do `.env.example` e senhas com menos de 12
caracteres.

O banco e o Redis rodam em container; o app e o worker rodam direto na
máquina, porque o Next dentro de container é lento no Windows. Para subir tudo
em container, como em produção: `pnpm stack:up`.

### Comandos do dia a dia

| Comando | O que faz |
|---|---|
| `pnpm dev` | app e worker, recarregando ao salvar |
| `pnpm test` | todos os testes (os de banco rodam quando o Postgres está de pé) |
| `pnpm lint` / `pnpm typecheck` | o que o CI confere antes de cada merge |
| `pnpm build` | build de produção |
| `pnpm db:studio` | abre o banco numa interface para olhar e editar dados |
| `pnpm services:up` / `pnpm services:down` | liga e desliga Postgres e Redis |

---

## Conectando as integrações

Nenhuma é obrigatória: sem a configuração, o recurso simplesmente não aparece
ou avisa o que falta. Credenciais de integração ficam cifradas no banco, nunca
no `.env`, a menos que esteja dito abaixo.

**Login com Google.** Crie um OAuth client *Web* no Google Cloud, com o
redirecionamento `https://<seu-domínio>/api/auth/callback/google`, e preencha
`AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET` e `ALLOWED_EMAIL_DOMAIN`
(`evecompany.com.br`).

**Google Agenda.** Usa o mesmo OAuth client do login. No projeto do Google
Cloud: ative a *Google Calendar API*, adicione o redirecionamento
`https://<seu-domínio>/api/connectors/google-calendar/callback` e deixe a tela
de consentimento como **Interno**. (Em "Externo" + "Teste", o Google derruba o
acesso a cada 7 dias.) Depois, um admin vai em **Equipe > Conectores > Google
Agenda > Conectar com Google** e escolhe a conta.

**Meta (Instagram e Facebook).** Na página do cliente, *Adicionar conector >
Meta*. Você vai precisar de:
- o **ID da Página** (número em Configurações > Sobre, na própria Página);
- o **ID da conta do Instagram**, se for publicar lá (conta Business ou
  Creator, vinculada à Página);
- um **token de acesso da Página** de longa duração, de preferência de um
  *System User* do Business Suite, com `pages_show_list`,
  `pages_read_engagement`, `pages_manage_posts`, `instagram_basic` e
  `instagram_content_publish`.

Para o Meta conseguir baixar as imagens dos posts, o app precisa estar num
endereço público. Se ele não descobrir sozinho, defina `PUBLIC_BASE_URL`.

**Notion.** Em Equipe > Conectores. Crie uma *Internal Integration* em
notion.so/my-integrations, compartilhe a database com ela (menu "..." >
Conexões) e cole o segredo e a URL da database.

**Google Ads** (somente leitura, de propósito), na página do cliente. Junte o *developer token*
(API Center da conta MCC), um OAuth client ID e secret, um *refresh token* com
o escopo `https://www.googleapis.com/auth/adwords` (pelo OAuth Playground) e o
ID da conta de 10 dígitos, mais o da MCC se você entra por uma.

**Assistente (Claude).** Preencha `ANTHROPIC_API_KEY` no `.env`.

**E-mail dos relatos de bug.** Preencha `SMTP_URL` (o `.env.example` mostra o
formato para o Google Workspace). Sem ele, o relato chega no sino e no
registro de atividades.

---

## Em produção

O app roda numa VPS da Hostinger. O `docker-compose.yml` sobe tudo:

```bash
docker compose --profile full up -d --build
```

- **Configuração:** um `.env` na raiz do servidor, a partir do
  `.env.example`. Em produção o app **não sobe** sem `PUBLIC_BASE_URL` e
  `AUTH_URL` (o domínio real, em https, os dois iguais) e sem
  `ALLOWED_EMAIL_DOMAIN`. O `docker compose` não roda sem `POSTGRES_PASSWORD`,
  `POSTGRES_APP_PASSWORD` e `REDIS_PASSWORD`.
- **Banco:** web e worker conectam como `evehub_app`, que lê e grava dados mas
  não muda o schema. O superusuário `eve` só é usado pelos passos de preparo
  (`db-init`, que cria/atualiza o `evehub_app`, e `migrate`). As URLs de
  conexão dos containers são montadas pelo `docker-compose.yml` a partir das
  senhas; o `DATABASE_URL`/`REDIS_URL` do `.env` só vale fora do Docker.
  Trocar a senha do `eve` num volume existente exige também
  `ALTER USER eve WITH PASSWORD '...'` dentro do Postgres.
- **Rede:** app, banco e Redis escutam só no próprio servidor (`127.0.0.1`). O
  proxy reverso (Caddy) é a única porta pública e cuida do https. Para abrir o
  banco do seu computador, use um túnel SSH, não abra a porta.
- **Uploads** ficam num volume (`uploads_data`), fora da imagem. Rodando fora
  do Docker, eles ficam em `apps/web/.uploads`.
- **Atualizando:** traga o código novo e rode o comando acima. As migrations
  são aplicadas sozinhas pelo serviço `migrate` antes de web e worker subirem;
  se uma falhar, os dois não sobem (`docker compose logs migrate` mostra o
  motivo).
- **Seed** (só na primeira instalação):
  `docker compose --profile full run --rm migrate node_modules/.bin/tsx infra/prisma/seed.ts`
- **O worker precisa estar de pé:** é ele que sincroniza as integrações e
  publica os posts agendados. Num deploy ele tem até 3 minutos para terminar
  o que está publicando antes de ser encerrado.

---

## Problemas comuns

**O login fica em "Entrando...".** Quase sempre é Postgres ou Redis parado.
`docker compose ps` precisa mostrar os dois como *healthy*; `pnpm services:up`
sobe os dois. Com o Redis parado o login funciona, só sem limite de
tentativas. Com o Postgres parado a tela diz "Serviço indisponível", e não
"senha incorreta".

**Um post não saiu.** Confira se o worker está rodando: sem ele, nada é
publicado. Um post que ficou parado em "publicando" (o worker reiniciou no
meio) ainda precisa de ajuda manual; a correção está descrita em
[`docs/handoff-scheduling.md`](docs/handoff-scheduling.md).

**Uma integração ficou vermelha.** O cabeçalho do módulo mostra o erro, e os
admins recebem um aviso quando uma integração para de sincronizar. Quase sempre
é token vencido: reconecte em Equipe > Conectores ou na página do cliente.

**`pnpm lint` não acha o eslint.** Link quebrado do pnpm: apague `node_modules`
e rode `pnpm install`. Mantenha o pnpm na versão 10 (o `packageManager` do
`package.json` já fixa isso).

---

## Para quem mexe no código

```
apps/
  web/       Next.js: páginas, API e login
  worker/    processo separado: sincronização, publicação de posts, limpeza
packages/
  core/            banco, cifra de credenciais, eventos, sincronização
  connector-sdk/   o contrato que toda integração implementa
  ui/              componentes, estilos e todos os textos em português
  connectors/      uma pasta por integração (meta, notion, google-ads, ...)
infra/
  prisma/    schema, migrations e seed
  Dockerfile.web, Dockerfile.worker
docs/        planejamento, arquitetura e o próximo trabalho
```

**Algumas regras da casa:**
- Código, commits e comentários em inglês; tudo o que a pessoa lê na tela em
  português, centralizado em `packages/ui/src/strings.ts`.
- `@eve/core` é só servidor. Componentes do navegador importam
  `@eve/core/dashboard`.
- Toda rota que muda algo do time chama `logActivity()`
  ([`apps/web/src/lib/activity.ts`](apps/web/src/lib/activity.ts)).
- As permissões vivem em
  [`apps/web/src/lib/permissions.ts`](apps/web/src/lib/permissions.ts).
- Edição de dados externos usa trava otimista por registro, e o desfazer relê a
  versão atual antes de reverter. Não existe "forçar escrita".

**Integração nova:** crie `packages/connectors/<nome>/` implementando o
`EveConnector` (use `packages/connectors/demo` como modelo, ele implementa o
contrato inteiro). Importe o pacote em `apps/web/src/connectors.ts` e em
`apps/worker/src/index.ts`, declare a dependência nas duas apps e copie o
`package.json` dele nos dois Dockerfiles. Se esquecer alguma dessas ligações,
`apps/web/src/connectors.test.ts` quebra na hora. Uma agenda nova (Outlook,
por exemplo) implementa também o `calendar` do contrato e aparece na Agenda do
Time sem mudar mais nada.

### Documentos

| | |
|---|---|
| [`CHANGELOG.md`](CHANGELOG.md) | o que entrou em cada versão, e o que está em aberto |
| [`docs/handoff-scheduling.md`](docs/handoff-scheduling.md) | próximo trabalho: publicação de posts confiável |
| [`docs/dashboard-evecompany-planejamento.md`](docs/dashboard-evecompany-planejamento.md) | o plano original do produto |
| [`docs/eve-hub-v0.0.2-arquitetura.md`](docs/eve-hub-v0.0.2-arquitetura.md) | os princípios de arquitetura |
| [`docs/eve-hub-v0.0.3-escopo.md`](docs/eve-hub-v0.0.3-escopo.md) | a fundação (v0.0.3) e as correções ao modelo de dados |
| [`docs/eve-dashboard-prototype.html`](docs/eve-dashboard-prototype.html) | o protótipo visual de onde vieram as cores e fontes |
