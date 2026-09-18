# Eve Hub — Manual QA Checklist

Derived from the UI source at commit `1a81221`, not from PROJECT_PLAN.md. Every
control that a user can see or click is listed. Walk it with the app open and
record what you actually observe.

## How to record results

Put one of these in the **St.** column:

| Mark | Meaning |
|---|---|
| `OK` | Works as expected |
| `PART` | Works partly — write what fails in Notes |
| `X` | Visibly broken or does nothing |
| `GONE` | Control is not there at all (code says it should be) |
| `?` | Couldn't test — say why |

The **Code says** column is what the source claims. Where your observation
disagrees with it, that disagreement is the most valuable output of this pass —
flag it. Anything marked **(SILENT)** means a failure would look identical to
success, so test it deliberately rather than at a glance.

---

## 0. Setup before you start

- [ ] `pnpm services:up && pnpm db:migrate && pnpm db:seed && pnpm dev` → http://localhost:3000
- [ ] Log in as the seeded owner (`SEED_OWNER_EMAIL`).
- [ ] **Create a second, non-owner account**: Equipe → *Adicionar* → name, email, password (min 8 chars). The seed creates **only the owner**, so without this you will test everything with full visibility and miss every gating bug.
- [ ] Create a Role (Equipe → *Gerenciar cargos*) granting only some tabs, and assign it to the second account.
- [ ] Keep a second browser profile / private window logged in as that member, so you can switch without logging out.

> Most findings below that involve permissions only appear on the **member**
> account. Where a row says *(check as member)*, test it in that window.

---

## 1. Login and access

| # | Control / behaviour | Where | Code says | St. | Notes |
|---|---|---|---|---|---|
| 1.1 | Email + password login | `/login` | Works; argon2id | | |
| 1.2 | Wrong password message | `/login` | Generic "invalid credentials", no hint whether the email exists | | |
| 1.3 | 6th failed attempt in 15 min | `/login` | Rate-limited message (needs Redis up) | | |
| 1.4 | "Entrar com Google" button | `/login` | Only renders if `AUTH_GOOGLE_ID` + `AUTH_GOOGLE_SECRET` are set | | |
| 1.5 | Google login completes | `/login` | Works; restricted to `ALLOWED_EMAIL_DOMAIN` — **if that var is empty, any Google account gets in** | | |
| 1.6 | Disabled account can't log in | Equipe → Desativar, then try | Refused for both providers | | |
| 1.7 | Disabled mid-session is logged out | Disable the member while they're browsing | Next request logs them out | | |
| 1.8 | Logout | Ctrl+K → sign out | Returns to `/login` | | |
| 1.9 | Visiting a page while logged out | `/jobs` in a private window | Redirects to `/login` | | |

---

## 2. Side rail and global chrome (visible on every page)

| # | Control | Where | Code says | St. | Notes |
|---|---|---|---|---|---|
| 2.1 | Rail expand/collapse arrow | Rail top | Local only, remembered in localStorage | | |
| 2.2 | Rail fully hidden + reveal tab | Only when Settings → Interface → "Esconder barra lateral" is on | Local only | | |
| 2.3 | Home icon | Rail | → `/` | | |
| 2.4 | Chat / Jobs / Tabelas / Conectores / Automações icons | Rail | Navigate; always visible (default tabs) | | |
| 2.5 | Financeiro / Equipe icons | Rail | **Only** with a Role granting them *(check as member)* | | |
| 2.6 | "Agenda" group — collapsed rail | Rail | Click → `/agenda` | | |
| 2.7 | "Agenda" group — expanded rail | Rail | Click only opens the submenu | | |
| 2.8 | Submenu → "Minha Agenda" | Rail | → `/agenda?mine=1` | | |
| 2.9 | Submenu → "Agendar Post" | Rail | → `/scheduling?new=1` | | |
| 2.10 | Submenu → "Time" | Rail | → `/agenda` | | |
| 2.11 | Gear icon | Rail bottom | → `/settings` | | |
| 2.12 | **Whole Agenda group hidden for a plain member** | Rail *(check as member)* | `/agenda` is gated by the **scheduling** tab, which is not a default — decide if that's intended | | |
| 2.13 | Ctrl+K command palette opens | Anywhere | Indexes every page + setting + canvas action | | |
| 2.14 | Palette search finds a setting and jumps to it highlighted | Ctrl+K → type a setting name | Deep-links and highlights for ~2s | | |
| 2.15 | Notification bell opens dropdown | Rail | Also asks for browser notification permission | | |
| 2.16 | Bug report pill | Bottom-left | Opens modal | | |
| 2.17 | Custom cursor follower | Anywhere | Toggle in Settings → Interface | | |

---

## 3. Dashboard — grid mode (`/`)

| # | Control | Where | Code says | St. | Notes |
|---|---|---|---|---|---|
| 3.1 | Theme toggle (escuro/claro) | Header | Persists to your dashboard config | | |
| 3.2 | Avatar button | Header | → `/perfil` | | |
| 3.3 | "Layout salvo" indicator | Header | Appears after a successful save | | |
| 3.4 | Empty board state | Fresh account | "Board vazio" + hint | | |
| 3.5 | Right-click → Adicionar módulo → *(connector)* | Empty space | Creates instance, or opens credential form | | |
| 3.6 | Right-click a widget → Travar/Destravar | On a widget | Persists | | |
| 3.7 | Right-click a widget → Remover | On a widget | Removes from layout | | |
| 3.8 | Drag a widget to reposition | Grid | Persists | | |
| 3.9 | Resize a widget | Grid | Persists | | |

---

## 4. Dashboard — canvas mode (`/`, Settings → Layout → Modo: Quadro)

| # | Control | Where | Code says | St. | Notes |
|---|---|---|---|---|---|
| 4.1 | Pan (space+drag, or middle mouse) | Canvas | Viewport saved | | |
| 4.2 | Marquee select / shift-click multi-select | Canvas | Local selection | | |
| 4.3 | Drag a node | Canvas | Persists | | |
| 4.4 | Resize a node | Canvas | Persists | | |
| 4.5 | Connect two nodes into a "tela" | Drag the connect handle | Persists | | |
| 4.6 | Right-click bg → Adicionar módulo | Canvas | Per-connector, disabled if you can't create it | | |
| 4.7 | Right-click bg → Adicionar texto | Canvas | Creates a text node | | |
| 4.8 | Right-click bg → Colar imagem (Ctrl+V) | Canvas | Uploads via `/api/uploads/canvas-image` **(SILENT on failure — nothing appears, no error)** | | |
| 4.9 | Drag an image file onto the canvas | Canvas | Same upload path **(SILENT)** | | |
| 4.10 | Enquadrar tudo (Ctrl+1) / Redefinir zoom (Ctrl+0) | Canvas | Viewport | | |
| 4.11 | Mostrar grade / Ajustar à grade toggles | Right-click bg | Persist | | |
| 4.12 | Travar quadro | Right-click bg | Persists | | |
| 4.13 | Desfazer (Ctrl+Z) / redo (Ctrl+Shift+Z) | Canvas | **In-memory only — lost on reload, by design** | | |
| 4.14 | Right-click node → Editar texto / Renomear módulo | Node | Uses `window.prompt` | | |
| 4.15 | Right-click node → Duplicar (Ctrl+D) | Node | Persists | | |
| 4.16 | Right-click node → Trazer para frente / Enviar para trás | Node | Persists | | |
| 4.17 | Right-click node → Renomear tela / Ajustar à tela | Node in a screen | Persists | | |
| 4.18 | Delete / Backspace removes selection | Canvas | Persists | | |
| 4.19 | Arrow keys nudge (Shift = bigger step) | Canvas | Persists | | |
| 4.20 | Placeholder for a deleted connector instance | Canvas | Shows a "Remover" button | | |

---

## 5. Widgets (add one of each from the board)

| # | Widget | What to check | Code says | St. | Notes |
|---|---|---|---|---|---|
| 5.1 | **Demo** | Table renders, cell edit saves | Live, seeded fake data | | |
| 5.2 | **Notion** | Rows load; edit a cell; undo | Live (needs a Notion token) | | |
| 5.3 | **Meta** | Renders via the generic engine — no bespoke widget | Intentional, not a gap | | |
| 5.4 | **Notes** | Type, blur, reload — text persists | Live (Redis) | | |
| 5.5 | **Chat (Claude)** | Send a message, get a reply; "Limpar" clears | Live; needs `ANTHROPIC_API_KEY`, else says not configured | | |
| 5.6 | **Calculator** | Buttons compute | **Toy by design — no persistence. Not a bug.** | | |
| 5.7 | **Calendar** | Month grid, prev/next | **Placeholder by design — never shows events. Not a bug.** | | |
| 5.8 | **Overview** | Renders | Stub connector; widget reads other APIs client-side | | |
| 5.9 | **Today** | Notification + agenda lists, rows link out | Live | | |
| 5.10 | Widget menu → Configurar (view config) | Any data widget | Kind select, field visibility, reorder — persists to *your* dashboard | | |
| 5.11 | Widget menu → Sincronizar agora | Any connector widget | `POST /api/instances/:id/sync` | | |
| 5.12 | Widget menu → Desfazer última edição | After editing a cell | `POST /api/instances/:id/undo` | | |
| 5.13 | Edit conflict banner | Edit the same row from two windows | Shows 409 + "Recarregar" | | |
| 5.14 | Widget crash boundary | — | Shows "Tentar novamente" + "Remover" | | |

---

## 6. Jobs (`/jobs`)

### 6a. Board

| # | Control | Code says | St. | Notes |
|---|---|---|---|---|
| 6.1 | "Gerenciar colunas" toggle | Local UI mode only | | |
| 6.2 | "+ Nova coluna" | `POST /api/jobs/columns` | | |
| 6.3 | Drag a column to reorder (manage mode) | Persists; on failure the board reloads and snaps back | | |
| 6.4 | Right-click column → Renomear | `window.prompt` → PATCH. **Any user, not owner-only** *(check as member)* | | |
| 6.5 | Right-click column → Apagar | Blocked server-side while the column still holds jobs — check the error is readable | | |
| 6.6 | Column "+" → new job | `POST /api/jobs` | | |
| 6.7 | **Drag a card between columns** | Optimistic, then PATCH; reverts via reload on failure | | |
| 6.8 | Deep link `?job=<id>` | Opens that card. Silently does nothing for an unknown id | | |
| 6.9 | Empty board state | Giant "+" | | |

### 6b. Job detail modal

| # | Control | Code says | St. | Notes |
|---|---|---|---|---|
| 6.10 | Header ▶/⏸ general timer | **(SILENT — see §15)** | | |
| 6.11 | "!" important toggle | PATCH | | |
| 6.12 | Client badge link / "×" unlink | Link + PATCH `{clientId:null}` | | |
| 6.13 | Title inline edit (blur saves) | PATCH | | |
| 6.14 | Description click-to-edit, Escape reverts | PATCH on blur | | |
| 6.15 | Formatting bubble on description (B/I/S/code/quote/link) | Inserts Markdown; **only persists when the field blurs** | | |
| 6.16 | Client names auto-highlighted in the description are clickable | Links the job to that client | | |
| 6.17 | Due date | PATCH | | |
| 6.18 | "Projeto" select (only if the job has a client) | PATCH | | |
| 6.19 | "Abrir pasta do projeto →" | → `/projects/:id` | | |
| 6.20 | Add/remove collaborator | POST / DELETE | | |
| 6.21 | Task: checkbox done | PATCH | | |
| 6.22 | Task: ▶/⏸ task timer | **(SILENT — see §15)** | | |
| 6.23 | Task: assignee select | PATCH | | |
| 6.24 | Task: "!" important | PATCH | | |
| 6.25 | Task: paperclip attach | POST multipart | | |
| 6.26 | Task: **drag a file onto the task row** | Same upload | | |
| 6.27 | Task: delete (×) | DELETE | | |
| 6.28 | Attachment link opens / "×" removes | Link / DELETE | | |
| 6.29 | "+ Nova tarefa" | POST | | |
| 6.30 | **"Apagar job" — note whether it asks for confirmation** | Code has **no confirm dialog** | | |
| 6.31 | Comentários: send (Enter or button) | POST | | |
| 6.32 | Comentários: delete own comment only | Others' comments show no × | | |
| 6.33 | Timesheet tab: click a duration to edit, Salvar | PATCH | | |
| 6.34 | Timesheet: entering 0 or a negative duration | **Silently no-ops, no message** | | |
| 6.35 | Timesheet: delete an entry | DELETE | | |
| 6.36 | **Timesheet: can you edit a *colleague's* entry?** *(check as member)* | **Server does not check ownership — you can. This is finding H-4.** | | |

---

## 7. Projects (`/projects/[id]`) and Clients (`/clients/[id]`)

| # | Control | Code says | St. | Notes |
|---|---|---|---|---|
| 7.1 | Project title / date / description inline edit | PATCH on blur | | |
| 7.2 | Delete project (🗑) | Asks `window.confirm` first | | |
| 7.3 | Jobs tab → "+ Adicionar job existente" | Lazy-loads jobs, PATCH to attach | | |
| 7.4 | Jobs tab → "×" unlink a job | PATCH `{projectId:null}` | | |
| 7.5 | Tarefas tab → checkbox across all jobs | PATCH | | |
| 7.6 | Comentários tab → pick a job, then comment | POST; Send disabled until both are set | | |
| 7.7 | Arquivos tab → attachment links | Plain links | | |
| 7.8 | Client page → "+ Novo projeto" | POST | | |
| 7.9 | **Client page → new-project form: does Enter submit?** | **No — only Escape is handled. Every other form here submits on Enter.** | | |
| 7.10 | Client page → project card link | → `/projects/:id` | | |
| 7.11 | "Jobs sem projeto" rows link out | → `/jobs?job=` | | |
| 7.12 | Client name/notes are **not** editable here | By design — edit them in Tabelas → Clientes | | |

---

## 8. Tables (`/tables`)

### 8a. Tabelas tab

| # | Control | Code says | St. | Notes |
|---|---|---|---|---|
| 8.1 | Table picker select | Loads rows | | |
| 8.2 | "+ Nova tabela..." → Criar | POST; starts with one "Nome" text column | | |
| 8.3 | ⋯ → **Exportar CSV** | Downloads; resolves client ids to names | | |
| 8.4 | ⋯ → **Importar CSV** | **Now implemented (commit `21b289c`) — your plan says otherwise. Retest.** | | |
| 8.5 | Import: header labels that don't match a column | **Silently dropped, no per-column warning** | | |
| 8.6 | Import: empty cells | Skipped — you cannot blank a value via import | | |
| 8.7 | **Import into a `Número` column, then click the cell** | **Stores the raw string `"42"`, not the number `42` — manual entry coerces, import doesn't. Same for Sim/Não and Data.** | | |
| 8.8 | Import: all rows succeed | **No success message at all — rows just appear** | | |
| 8.9 | Import: a large file | One HTTP request per row, no progress bar | | |
| 8.10 | ⋯ → Automação (webhook) | Opens modal | | |
| 8.11 | ⋯ → Apagar tabela | DELETE | | |

### 8b. Grid

| # | Control | Code says | St. | Notes |
|---|---|---|---|---|
| 8.12 | Right-click header → Editar / Adicionar coluna | PATCH | | |
| 8.13 | Right-click header → Remover coluna | PATCH | | |
| 8.14 | **Remover coluna on a one-column table** | **Silent no-op — nothing happens, no message** | | |
| 8.15 | Column type **Texto** | Text input | | |
| 8.16 | Column type **Número** | Number input, coerced on manual entry | | |
| 8.17 | Column type **Sim/Não** | Checkbox, saves on toggle | | |
| 8.18 | Column type **Data** | Date input | | |
| 8.19 | Column type **Seleção** + Opções field | Select from comma-separated options | | |
| 8.20 | Column type **Cliente** | Select of local clients | | |
| 8.21 | Cliente cell → "+ Novo cliente..." | `window.prompt` → POST → assigns | | |
| 8.22 | Right-click row → Adicionar / Remover linha | POST / DELETE | | |
| 8.23 | "+ linha" row at the bottom | Same as Adicionar linha | | |
| 8.24 | Cell edit: Enter/blur saves, Escape cancels | PATCH | | |
| 8.25 | **Sorting or filtering** | **Does not exist — don't look for it** | | |
| 8.26 | Empty table | **No "no rows" message, just the header + "+ linha"** | | |

### 8c. Webhook modal

| # | Control | Code says | St. | Notes |
|---|---|---|---|---|
| 8.27 | Gerar link / Gerar novo link | POST, rotates | | |
| 8.28 | Copiar | **(SILENT) — clipboard denial just never shows "Copiado!"** | | |
| 8.29 | **Desativar** | **(SILENT) — a failed DELETE shows nothing at all** | | |
| 8.30 | "Coluna usada para casar linhas" | PATCH | | |
| 8.31 | Any log of past webhook calls | **Does not exist here** | | |
| 8.32 | **Can a non-owner read and rotate the token?** *(check as member)* | **Yes — finding M-3. Token is returned to every member by `GET /api/tables`.** | | |

### 8d. Clientes tab

| # | Control | Code says | St. | Notes |
|---|---|---|---|---|
| 8.33 | "+ Novo cliente" → Criar | POST | | |
| 8.34 | Row ✎ edit → Salvar | PATCH | | |
| 8.35 | **Row 🗑 delete — note whether it confirms** | **No confirmation. One click deletes.** | | |
| 8.36 | Delete a client that has projects/jobs/financial entries | **Cascades: projects deleted, jobs/posts/financial entries lose the link. Finding M-4.** | | |

---

## 9. Agenda (`/agenda`)

| # | Control | Code says | St. | Notes |
|---|---|---|---|---|
| 9.1 | Page visible at all | **Requires the scheduling tab** *(check as member — expect a redirect)* | | |
| 9.2 | Membro / Cliente filters | Refetch | | |
| 9.3 | **Filter dropdowns are empty** | Member/client load failures are swallowed — empty looks the same as broken | | |
| 9.4 | "Agendar post (Meta) →" | → `/scheduling?new=1` | | |
| 9.5 | "+ Novo evento" | Opens editor | | |
| 9.6 | Month ‹ / › | Refetches that month | | |
| 9.7 | Click a day → create pre-filled | Opens editor | | |
| 9.8 | Click an event chip → edit | Opens editor | | |
| 9.9 | Editor: título, descrição, dia inteiro, início, fim, cliente, cor, participantes | Saved on submit | | |
| 9.10 | Editor: cor accepts any text | No hex validation, unlike the Jobs colour fields | | |
| 9.11 | Editor: someone else's event | All fields disabled, no Save/Delete | | |
| 9.12 | **Editor: "Excluir"** | **(SILENT) — a failed delete gives zero feedback. Also no confirmation dialog.** | | |
| 9.13 | Empty month | **No empty-state message, just a blank grid** | | |

---

## 10. Scheduling — "Agendar post" (`/scheduling`)

| # | Control | Code says | St. | Notes |
|---|---|---|---|---|
| 10.1 | Page visible at all | Requires scheduling tab *(check as member)* | | |
| 10.2 | "Conectar no Conectores" hint when no Meta account | → `/connectors` | | |
| 10.3 | Cliente / Membro / Status filters | Server-side query params | | |
| 10.4 | Instagram / Facebook toggles | **Client-side only, applied after fetch** | | |
| 10.5 | "+ Novo post" | **Disabled until a Meta account exists** — legitimate, not a stub | | |
| 10.6 | **Clicking a day with no Meta account** | **Silently does nothing — no message** | | |
| 10.7 | Failed-posts banner + "Não publicados" panel | Read-only counts | | |
| 10.8 | Editor: Cliente, Conta selects | Required; account list filtered for Instagram targets | | |
| 10.9 | Editor: Carrossel checkbox | Only for new posts, Instagram-feed-only; auto-unchecks if targets change | | |
| 10.10 | Editor: media drop zone / click to choose | Uploads | | |
| 10.11 | Carousel: drag to reorder slides, × to remove | Local until submit | | |
| 10.12 | Editor: Legenda | **Hidden entirely for story-only targets** | | |
| 10.13 | Editor: target buttons (FB feed/story/reel, IG feed/story/reel) | **New posts only — hidden when editing** | | |
| 10.14 | Targets auto-disable for incompatible media | e.g. a photo disables Reel | | |
| 10.15 | "Agendar" / "Agendar (N)" | POST per target; partial success drops the ones that worked so a retry doesn't duplicate | | |
| 10.16 | **"Postar agora"** | **Not immediate — it writes a scheduled row the worker picks up on its next tick** | | |
| 10.17 | **Opening an already-published post** | Form opens fully editable, then **Salvar returns a 409** — server-side guard only | | |
| 10.18 | **"Cancelar post"** | **(SILENT) — a failed DELETE shows nothing. Also deletes published posts' local rows with no status guard.** | | |
| 10.19 | Preview tabs | Cosmetic; **like counts etc. are hardcoded mockup text** | | |

---

## 11. Chat (`/chat`)

| # | Control | Code says | St. | Notes |
|---|---|---|---|---|
| 11.1 | Equipe / Privado tabs | Local | | |
| 11.2 | Send message (Enter; Shift+Enter = newline) | POST; polls every 6s | | |
| 11.3 | @mention autocomplete (Equipe only) | Inserts and tracks the mention | | |
| 11.4 | **@mention list is empty** | Member-fetch failure is swallowed — looks like an empty team | | |
| 11.5 | Emoji picker | ~36 curated emoji, inserts at cursor | | |
| 11.6 | Attach file (paperclip) and drag-and-drop | Uploads | | |
| 11.7 | **Upload a `.svg` or `.html` to chat** | **No type allowlist on this route — finding H-1** | | |
| 11.8 | Remove a pending attachment before sending | Local | | |
| 11.9 | Delete own message (×) | Others' show no × | | |
| 11.10 | Formatting bubble: **B**, *I*, ~~S~~, code, quote, link | All six genuinely apply Markdown, rendered by RichText | | |
| 11.11 | Bare URLs auto-link | Via Linkify | | |
| 11.12 | **A local path (`/home/...`, `C:\...`) renders as a link** | **Clicking does nothing in a browser — known limitation, not a new bug** | | |
| 11.13 | Privado: start a conversation with a member | POST; only lists members you have no thread with | | |
| 11.14 | Privado: empty states (no thread / no messages / no members) | Three distinct messages | | |

---

## 12. Connectors (`/connectors`)

| # | Control | Code says | St. | Notes |
|---|---|---|---|---|
| 12.1 | Connector card → detail modal | Read-only | | |
| 12.2 | "Conectar" / "+ Nova conexão" | Opens credential form, or POSTs directly if no credentials needed | | |
| 12.3 | Credential form (Notion token / Meta pageId + token) | POST; secret never returned afterwards | | |
| 12.4 | "Sincronizar" | POST sync | | |
| 12.5 | "Desconectar" | **Owner-only** *(check as member — expect it hidden/403)* | | |
| 12.6 | First sync fails after connecting | Instance still created, error shown inline — deliberate | | |
| 12.7 | **As a member, can you change a Meta connector's config?** *(check as member)* | **Yes — finding M-1. Only credentials are owner-gated, config is not.** | | |

---

## 13. Automations (`/automations`)

| # | Control | Code says | St. | Notes |
|---|---|---|---|---|
| 13.1 | Page visible | Any authenticated user | | |
| 13.2 | "Gerar link" / "Gerar novo link" | **Owner-only** *(check as member)* | | |
| 13.3 | "Copiar" | Shows "Copiado!" for 1.5s | | |
| 13.4 | "Desativar" | DELETE | | |
| 13.5 | Activity log rows expand to raw JSON | Local expand | | |
| 13.6 | **As a member, can you read the log payloads?** *(check as member)* | **Yes — finding M-6. Writing the token is owner-only, reading the results isn't.** | | |
| 13.7 | No workflow builder | **Intentional — not a missing feature** | | |

---

## 14. Financial, Notifications, Perfil, Equipe, Settings

### Financial (`/financial`)

| # | Control | Code says | St. | Notes |
|---|---|---|---|---|
| 14.1 | Page visible | **Only via a Role granting `financial`** *(check as member)* | | |
| 14.2 | "+ Novo lançamento" → Salvar | POST; accepts comma or dot decimals | | |
| 14.3 | Empty description or amount ≤ 0 | **Silently no-ops, no validation message** | | |
| 14.4 | Row ✎ edit | **Only description and amount — date/type/client/job are fixed after creation, by design** | | |
| 14.5 | Row 🗑 delete | **No confirmation** | | |
| 14.6 | Cliente / Job dropdowns empty | Load failures are swallowed | | |
| 14.7 | Entradas / Saídas / Saldo totals | Computed client-side | | |

### Notifications

| # | Control | Code says | St. | Notes |
|---|---|---|---|---|
| 14.8 | Bell badge updates | Polls; **a failed poll looks like "no new notifications"** | | |
| 14.9 | "Marcar todas como lidas" (bell and page) | POST **(SILENT on failure — optimistic)** | | |
| 14.10 | Click a notification | Marks read + navigates | | |
| 14.11 | Desktop notification + chime | Needs browser permission; silently absent otherwise | | |

### Perfil (`/perfil`)

| # | Control | Code says | St. | Notes |
|---|---|---|---|---|
| 14.12 | Editar → name, email, avatar → Salvar | PATCH | | |
| 14.13 | Avatar upload | POST | | |
| 14.14 | **Change email — is it verified?** | No verification step in code | | |
| 14.15 | Set / change password | PUT; current password required if one is set | | |
| 14.16 | Mostrar/Ocultar senha | Local toggle | | |

### Equipe (`/team`) — owner-only actions

| # | Control | Code says | St. | Notes |
|---|---|---|---|---|
| 14.17 | Adicionar → name, email, password, "Tornar owner" | POST | | |
| 14.18 | Per-member role select | PATCH | | |
| 14.19 | "Rebaixar" an owner | PATCH | | |
| 14.20 | **Promote an existing member to owner** | **Refused by design — admin can only be granted at creation** | | |
| 14.21 | Desativar / Ativar | PATCH | | |
| 14.22 | Remover (only after disabling) → two-step Sim/Cancelar | DELETE | | |
| 14.23 | Last-owner protections (demote/disable/delete the only owner) | All blocked with a readable error | | |
| 14.24 | Gerenciar cargos → create/edit/delete a Role, tab checkboxes | POST/PATCH/DELETE | | |
| 14.25 | **As a member with the `team` tab** *(check as member)* | **Page loads but the roster API 403s — known, safe-direction failure (L-9). Don't "fix" by opening `/api/users`.** | | |

### Settings (`/settings`)

| # | Control | Code says | St. | Notes |
|---|---|---|---|---|
| 14.26 | Aparência → background image upload / Remover | POST + persists | | |
| 14.27 | Aparência → background colour hex | Persists | | |
| 14.28 | Layout → Modo (Grade / Quadro) | Persists | | |
| 14.29 | Layout → Densidade | Persists | | |
| 14.30 | Interface → Esconder barra lateral | Persists | | |
| 14.31 | Interface → Bolinha seguindo o cursor | Persists | | |
| 14.32 | Comportamento → Atualizações em tempo real | Persists | | |
| 14.33 | Cores das colunas de Jobs | **Owner-only section** *(check as member — expect it absent)* | | |
| 14.34 | Column colour / opacity / border, "Limpar" | Debounced PATCH | | |
| 14.35 | "Redefinir configurações" | Resets to defaults | | |
| 14.36 | **Interface scale slider** | **Deliberately removed app-wide — don't go looking for it** | | |

### Bug report pill

| # | Control | Code says | St. | Notes |
|---|---|---|---|---|
| 14.37 | Anexar imagem | POST | | |
| 14.38 | Enviar | Row **is** saved to the database | | |
| 14.39 | **Does anyone actually receive it?** | **No. `sendBugReportEmail()` is a stub that only logs. There is no read UI and no email. Finding M-8 — the closest sibling to your CSV example.** | | |

---

## 15. Deliberate tests for things that fail silently

These cannot be checked by clicking once — a failure is visually identical to
success. Use devtools → Network → Offline, or block the request, then reload.

- [ ] **15.1 Timer stop.** Start a timer on a job. Go offline. Click stop — the UI will show "stopped". Go back online and **reload**. Is the entry still running server-side? *(Expected per code: yes, it is still running. This is the highest-value test in this document.)*
- [ ] **15.2 Timer start.** Go offline, click start. Does anything tell you it failed? *(Expected: no.)*
- [ ] **15.3 Canvas image paste.** Go offline, paste an image onto the canvas. *(Expected: nothing appears, no error.)*
- [ ] **15.4 Table webhook "Desativar".** Block the request, click it. *(Expected: looks like it worked.)*
- [ ] **15.5 Post editor "Cancelar post".** Block the request, click it. *(Expected: nothing at all happens.)*
- [ ] **15.6 Agenda event "Excluir".** Block the request, click it. *(Expected: no feedback.)*
- [ ] **15.7 "Marcar todas como lidas".** Block it, click, then reload. *(Expected: badge comes back.)*
- [ ] **15.8 Empty dropdowns.** Block `/api/workspace/members`, then open the Agenda member filter, the Financial client picker, and the chat @mention list. *(Expected: all silently empty, no error.)*

---

## 16. Permission matrix — verify on the member account

For each row: log in as the non-owner member and record what you actually see.

| Area | Plain member (default tabs) | With a Role granting the tab | Owner |
|---|---|---|---|
| Chat, Jobs, Tabelas, Conectores, Automações | visible | visible | visible |
| Agenda (`/agenda`) | **hidden** (needs `scheduling`) | visible | visible |
| Agendar post (`/scheduling`) | hidden | visible | visible |
| Financeiro | hidden | visible **and editable** | visible |
| Equipe | hidden | page loads, roster 403s | full management |
| Connector "Desconectar" | hidden | hidden | visible |
| Connector config edit | **allowed (M-1)** | allowed | allowed |
| Automations token | hidden | hidden | visible |
| Automations log payloads | **readable (M-6)** | readable | readable |
| Table webhook token | **readable + rotatable (M-3)** | same | same |
| Jobs column rename/delete | **allowed** | allowed | allowed |
| Jobs column colours | hidden | hidden | visible |
| Another user's time entry | **editable (H-4)** | editable | editable |

Anything in **bold** above is a gap the audit already found — confirming it from
the UI turns it from a code reading into a reproduced bug.

---

## 17. When you're done

Send back this file with the **St.** and **Notes** columns filled in. The rows
worth writing a sentence about:

1. Anything where your observation contradicts the **Code says** column.
2. Anything marked `GONE` — a control the code renders but you can't find.
3. The §15 silent-failure tests, with what you saw before and after reloading.
4. The §16 matrix, since that's the part that can't be checked from the owner account.

I'll turn that into a corrected PROJECT_PLAN.md and a scoped work plan.
