# Dashboard EveCompany — Planejamento Completo

Central única de visualização e ação pra todo o time da EveCompany, substituindo o vai-e-vem entre [[Notion]], [[Graph API - Meta]], [[Google Ads API]], [[n8n]] e outras ferramentas.

## Índice
- [[#Objetivo]]
- [[#Stack]]
- [[#Modelo de Dados]]
- [[#Sincronização]]
- [[#Edição Bidirecional - Notion]]
- [[#Autenticação]]
- [[#Módulos e Widgets]]
- [[#Ideias Extras - Brainstorm]]
- [[#IA no Feed Diário]]
- [[#Módulo IA (escopo controlado + skills)]]
- [[#Roadmap de Implementação]]
- [[#Projetos Relacionados]]

---

## Objetivo

Hoje o time usa várias ferramentas separadas pra gerenciar clientes e campanhas:
- **Notion** — tabelas com informações e status de clientes
- **mLabs** — agendamento de posts (sem API disponível, fora do escopo por enquanto)
- **Meta Business Suite** — via [[Graph API - Meta]]
- **Google Ads** — via [[Google Ads API]]
- **n8n** — automações internas (ex: [[Automação de Saldo BM]])

A dashboard centraliza a visualização (e parte da edição) de tudo isso em um só lugar, com sincronização periódica.

---

## Stack

- **Frontend:** Next.js/React, sistema de widgets modular e configurável por usuário
- **Backend:** Node.js (ou Python/FastAPI), workers agendados (cron)
- **Banco:** PostgreSQL (mesmo já usado em outros projetos da Eve)

---

## Modelo de Dados

Tabelas principais:
- `usuarios` — id, nome, email, senha/hash
- `integracoes` — tipo de fonte, token/config de autenticação
- `dashboard_config` — layout e módulos escolhidos por usuário
- `notion_cache` — espelho local das databases do Notion
- `edit_log` — histórico de edições (pra [[#Edição Bidirecional - Notion|rollback]])
- `automacoes_log` — histórico de execuções recebidas via webhook do [[n8n]]

---

## Sincronização

- Worker roda a cada **5-10 minutos** por integração, atualizando o `notion_cache` e dados de Ads/Meta.
- Campo `last_synced_at` por integração, exibido discretamente no rodapé de cada widget (ex: "atualizado há 3 min").
- **n8n:** ao invés do dashboard puxar dados do n8n, o n8n envia um **webhook** pro backend a cada execução → grava em `automacoes_log`. Mais simples e desacoplado.

---

## Edição Bidirecional - Notion

- Ícone de lápis por célula/linha editável nos widgets do Notion.
- **Optimistic locking:** ao carregar o dado, guarda o `last_edited_time` do Notion. Ao salvar, compara com o valor atual — se bateu, aplica o `PATCH`; se não bateu, avisa que o dado mudou e pede recarregar antes de salvar. Evita sobrescrever edições concorrentes sem precisar de polling constante.
- **Rollback de 10 minutos:** cada edição salva o valor antigo em `edit_log`. Botão de desfazer visível por 10 min; depois disso o log vira só auditoria.
- Meta e Google Ads ficam **somente leitura** por enquanto (edição bidirecional ali é mais arriscada, ex: mexer em campanha ativa).

---

## Autenticação

- Login simples (email/senha ou OAuth do Google).
- **Sem modelo de permissões por enquanto** — qualquer usuário autenticado vê e monta o dashboard como quiser, escolhendo livremente os módulos.

---

## Módulos e Widgets

### Confirmados
- Notion (leitura + edição)
- Meta Business Suite / Graph API (leitura) — reaproveitando a Graph API já configurada pra automação no n8n
- Google Ads (leitura) — token OAuth já disponível
- Log de automações do n8n (via webhook)

### Fora de escopo por enquanto
- ~~mLabs (sem API disponível)~~ → ver [[#Módulo de Agendamento de Posts (substituto do mLabs)]] abaixo — decidiu que vale construir um substituto próprio

---

## Módulo de Agendamento de Posts (substituto do mLabs)

**Motivação:** hoje o time programa posts no mLabs mas ainda precisa manter o Notion atualizado à parte (organizacional que todo mundo usa), porque a visualização/filtragem do mLabs é ruim pra esse fim. Um módulo próprio resolve isso num lugar só e corta o custo do mLabs.

**Viabilidade técnica (confirmada):**
- A **Instagram Content Publishing API** (parte da Graph API) permite publicar imagem, vídeo, reels e carrossel via API, de graça — contas Business/Creator conectadas a uma Página do Facebook, limite de 25 posts publicados por API a cada 24h.
- **Sem agendamento nativo pro Instagram** — o endpoint publica na hora que é chamado. Pra "agendar" de fato, precisa de um worker/cron do próprio backend que guarda o post configurado e dispara a chamada de publicação no horário certo (a dashboard já vai ter essa infraestrutura de workers pra sincronização, então reaproveita).
- **Facebook (Página)** tem agendamento nativo via parâmetro `scheduled_publish_time` na API — mais simples que o Instagram.

**Página separada na dashboard:**
- Fila de posts (agendado / publicado / erro)
- Preview do post antes de publicar
- Integração direta com a tabela de clientes do Notion (não precisa duplicar cadastro)

---

## Ideias Extras - Brainstorm

### Integrações adicionais
- **WhatsApp Business API** — visualização de conversas/status, restrita a quem tem posição de admin (ex: Marcele [[Marcele]]), já que o time tem celulares corporativos com números próprios
- ~~ManyChat — métricas de fluxo/automação~~ → ver nota sobre migrar mLabs pra ManyChat abaixo
- **Google Analytics / GA4** — tráfego dos sites; apela mais pra quem cuida de tráfego pago (Shelly)
- **Google Search Console** — posição de SEO, cliques, impressões; apela geral e também pra "Ma"
- **Instagram Insights** (via Graph API) — pro pessoal de mídia ver quais posts estão performando
- ~~Google Drive~~ — não usam Drive no dia a dia (preferem servidor local por causa de arquivos de mídia grandes) → em vez disso, **módulo de atalho/link direto pras pastas do servidor local**
- Financeiro (Conta Azul, Asaas, ou planilha) — status de pagamento por cliente
- **Log de automações + mensagens de erro + notificações de contas** — módulos prioritários
- **PageSpeed on-demand** — módulo que roda o teste na hora, sem sair da dashboard

### Nota: ManyChat como possível substituto parcial do mLabs
- Ideia de treinar o time pra usar mais o ManyChat (hoje só pra mensagens básicas de curso) e reduzir apps redundantes pagos pela Eve.
- **Ainda não confirmado** se o ManyChat cobre agendamento de posts orgânicos como o mLabs faz — ManyChat é forte em automação de conversa/chatbot, historicamente mais fraco em agendamento de publicação. Ver [[#Módulo de Agendamento de Posts (substituto do mLabs)]] como alternativa mais garantida.

### Features de produto
- **Visão por cliente** — modo "página do cliente" agregando tudo (Notion + Ads + Instagram + WhatsApp) daquele cliente
- **Botão de cliente global** no topo — troca o cliente em evidência e atualiza todos os módulos de uma vez, mas cada módulo pode ter um `cliente_override` fixo nas próprias configs, ignorando o global
- **Alertas automáticos** — saldo de anúncio baixo, campanha pausada, lead sem resposta há X horas (conecta com [[Automação de Saldo BM]]) — poucas ideias definidas ainda, vai crescer com o tempo
- **Feed de atividade diário personalizado** — resumo por usuário, cruzando dados desde a última vez que ele esteve online com base no que ele tem no `dashboard_config`, destacando as maiores discrepâncias/coisas mais importantes (não é só um changelog genérico, é sob medida por usuário)
- **Busca global** — ex: achar um post específico de um cliente que ninguém lembra onde está
- **Modo apresentação** — foco em animações/transições bonitas nos dados ao vivo, fullscreen, pensado pra usar em briefings com cliente (exportar PDF é secundário, prioridade é a experiência visual ao vivo)
- **Mural colaborativo interno** — anotações que sincronizam entre usuários como avisos/mensagens pro time, incluindo compartilhar links de arquivos do servidor local entre colegas sem precisar de Ctrl+C/Ctrl+V (basicamente um mini chat interno com anexo de link, sem depender de WhatsApp externo)
- **Módulo de anotações simples** (bloco de notas) com export configurável em .txt e .md
- **Dark mode / light mode** configurável por usuário
- **Atalhos de teclado**
- **Export de dados** (CSV/Excel/txt/imagem conforme o tipo suportado) — deveria ser opção disponível em **todos** os módulos, não só um módulo à parte

### Ideia paralela: dashboard como produto
- Potencial de vender esse conceito de dashboard pra outras empresas — pacote moderno e customizável de acordo com os apps que cada cliente já usa. Visto tanto como oportunidade da EveCompany quanto como projeto pessoal.

---

## IA no Feed Diário

- Volume baixo (time de até 20 pessoas, provavelmente menos de 10 usando o feed diariamente) → custo de chamadas à IA é praticamente irrelevante.
- **Pipeline:**
  1. Worker de sincronização calcula o delta por usuário (métrica, valor antigo, valor novo, %, módulo de origem) desde a última vez que ele esteve online, só pros módulos do `dashboard_config` dele.
  2. Chamada à IA disparada no login do usuário (não em horário fixo) — economiza chamadas de quem não abriu a dashboard naquele dia.
  3. Prompt: lista de deltas estruturados → pede resumo de 3-5 frases priorizando quedas/erros/oportunidades.
  4. Resposta cacheada em `feed_ia_log` (usuário, data, texto) — evita chamada duplicada no mesmo dia.
- **Modelo:** não precisa de modelo caro — sumarização de dados estruturados não exige raciocínio pesado, um modelo pequeno/rápido resolve.
- **Fallback:** sempre manter a versão sem IA (lista de deltas crus) disponível — o resumo de IA é camada opcional em cima, não dependência.
- Conecta com a ideia mais antiga do **"método sonhar"** (memória permanente que consolida os acontecimentos mais importantes) — o feed com IA é uma versão diária e por-usuário desse mesmo conceito.

---

## Módulo IA (escopo controlado + skills)

**Motivação:** ao invés de dar acesso livre da IA a tudo, o usuário define um escopo específico de dados pra analisar — mais seguro, mais barato, e mais previsível.

**Fluxo:**
1. **Seleção de escopo** — usuário escolhe de qual módulo puxar contexto (ex: tabela de saldo de um cliente, programação da semana de posts, performance do último mês de posts). O dado já cacheado no Postgres daquele módulo é serializado (JSON/markdown) como contexto.
2. **Pergunta livre** — campo de texto pra perguntar sobre aquele escopo, tipo chat com contexto anexado.
3. **Seleção de skill** — dropdown com as skills desenvolvidas no projeto paralelo de skills (ex: análise de concorrente — ver [[eve-ads-automation]]), cada skill sendo um prompt-template especializado + eventualmente uma tool específica.
4. **Chamada** — prompt final = instruções da skill + escopo selecionado + pergunta do usuário → IA → resposta na tela.
5. **Log de conversas** — salva pergunta/resposta/escopo usado por cliente, alimentando o "second brain" já cogitado em [[eve-ads-automation]].

**Nota de arquitetura:** o Módulo IA da dashboard deve ser **cliente** das skills (chamando via API/função), não reimplementar a lógica de skill dentro da dashboard — os dois projetos evoluem separados mas se conectam.

---

## Roadmap de Implementação

1. Setup do projeto (Next.js + backend + Postgres, schema das tabelas)
2. Autenticação básica
3. Integração Notion — leitura primeiro, depois escrita + rollback
4. Integração Graph API (Meta)
5. Integração Google Ads
6. Webhook receiver pro n8n + log de automações
7. Sistema de widgets configurável (drag / escolher módulos)
8. (Opcional, depois do MVP) Features extras do brainstorm acima

---

## Projetos Relacionados

- [[EvoTalks]] — CRM pros clientes da EveCompany, ideia paralela que pode compartilhar componentes de UI com essa dashboard
- [[Automação de Saldo BM]] — automação de monitoramento de saldo Meta/Google, candidata a virar alerta dentro da dashboard
- [[ManyChat]] / [[mLabs]] — ferramentas de automação/agendamento do time, possíveis integrações futuras
