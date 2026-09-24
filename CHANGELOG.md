# Changelog

## v0.1.0 — 2026-09-24

Primeira versao em uso diario. Consolida tudo o que entrou desde a fundacao
(v0.0.3, 2026-09-11): os connectors reais que estavam planejados para a v0.0.4
e o produto que cresceu em volta deles.

### Clientes e conteudo
- Pagina de cada cliente: cadastro (razao social, CNPJ, endereco...), marca e
  logo, jobs, arquivos, conectores do cliente e sub-tabelas.
- Calendario de Conteudo por cliente: cada linha e um conteudo, da ideia ao
  post. "Agendar post" abre o editor preenchido; o Status anda sozinho
  (Programado, Publicado quando o Meta confirma, Falhou). Botao direito num dia
  agenda ali mesmo. Roteiro abre em teleprompter.
- Agendar Post (`/scheduling`): Instagram (feed, carrossel, story, reel) e
  Facebook (feed, story), varios destinos de uma vez, lotes de posts separados.
- Cliente so conecta rede social (Meta) e Google Ads (so dados de anuncio).

### Time
- Agenda do Time e o Google Agenda conectado: todas as agendas marcadas na
  conta, filtros por agenda, cliente e membro; pessoas sao marcacao, nunca
  convite. Evento particular aparece como "Ocupado".
- Jobs (kanban) com tarefas, comentarios, anexos, colaboradores e apontamento
  de horas; timer flutuante.
- Projetos como pastas dentro do cliente.
- Chat do time, mensagens privadas, notificacoes.
- Tarefas: listas pessoais com @mencoes, /links e ferramentas no chat do Claude.
- Tabelas locais com importacao de CSV/zip do Notion, tags, galeria e
  calendario, e webhook de entrada.
- Financeiro e Automacoes (webhook do n8n com log).

### Equipe e administracao
- Admins sao uma lista fixa de e-mails. So entra quem um admin cadastrou;
  apagar conta de verdade; redefinicao de senha assistida por admin.
- Cargos liberam abas (todas ligadas por padrao, cargo so tira).
- Registro de atividades (`/activity`) de toda acao que mexe no que e do time.
- Conectores do time (Notion, Google Agenda, Google Ads, Claude) ficam em Equipe.
- Relato de bug chega no sino, no registro e por e-mail.
- Alerta para os admins quando uma integracao para de sincronizar.

### Dashboard
- Grade de 12 colunas; o modo canvas foi removido (os modulos de quem estava
  nele foram trazidos para a grade).
- Card de configuracoes em todo widget (⋮), Resumo do dia, Timer com Pomodoro,
  Notas, Calculadora, Calendario, Assistente (Claude).
- `Ctrl+K` busca paginas, cada configuracao e modulos.

### Connectors
- Meta (Instagram/Facebook), Notion (leitura, escrita, undo), Google Ads
  (somente leitura), Google Agenda, Claude.

### Seguranca (auditoria de 2026-09-18)
- Um anexo nao consegue mais apagar arquivos fora da pasta de uploads.
- Uploads sairam de `apps/web/public` (um `.svg` enviado virava pagina do app),
  sao servidos com tipo fixo e `nosniff`, e exigem login (menos midia de post,
  que o Meta baixa). A pasta antiga e movida sozinha no primeiro uso.
- Token do Meta vai no header, nao na URL; Page ID so numerico.
- Configurar um connector com credencial e rotacionar o webhook de uma tabela
  sao so de admin; apontamento de horas so pelo autor ou admin.
- Postgres e Redis escutam so em 127.0.0.1 no docker-compose.
- Erro 500 nao manda mais a mensagem do banco para o navegador.
- Link preview nao alcanca mais enderecos internos via IPv6 mapeado.
- nodemailer 10 (cinco alertas de seguranca do 8.x).

### Correcoes de uso
- Acao que falhava em silencio agora avisa (timer, webhook, colunas,
  financeiro, apontamento). O timer nao mostra mais "parado" quando o stop
  falhou, e o relogio nao volta mais a cada meio minuto.
- Apagar job, cliente, projeto, conector, evento ou lancamento pede confirmacao
  dentro do app, sem janela do navegador.

### Limpeza
- CSS, textos, componentes e dependencias sem uso removidos; funcoes repetidas
  unificadas (o link de notificacao do Resumo do dia divergia do sino).
- Versoes das ferramentas alinhadas entre os pacotes.

### Em aberto
- Publicacao de posts depende do worker e nao retoma post preso em
  "publicando": [`docs/handoff-scheduling.md`](docs/handoff-scheduling.md).
- Log de automacoes visivel para todo o time; token do webhook de tabela
  aparece na listagem de tabelas para todos; limite de tentativas de login
  sem dimensao de IP.
- Renomear coluna de job e link do editor de texto ainda usam `window.prompt`.
- Tabelas `AgendaEvent`/`AgendaEventAttendee` do banco nao sao mais usadas
  (a agenda e o Google); remover exige uma migration.
- Alertas de seguranca em `mysql2` e `deepmerge-ts`, dependencias da CLI do
  Prisma (nao rodam no app); somem com a proxima versao do Prisma.
