# Security & Stability Audit — Eve Hub

Date: 2026-09-18
Repo state audited: branch `claude/busy-gates-i1p75j` at commit `1a81221`, identical to `origin/main` at the time of the fetch that opened this run.
Method: static source review of the whole monorepo (no live traffic, no exploit payloads run against any deployment).

## Summary

The codebase is in better shape than its shape suggests. There is **no `middleware.ts` anywhere**, so all 68 API route handlers are individually responsible for their own access control — and every single one of them does authenticate. There is **zero raw SQL** in the repository, no server actions, no `eval`/`new Function`/`dangerouslySetInnerHTML`, no committed secrets and no `NEXT_PUBLIC_` variables. Password hashing is argon2id at the OWASP baseline with deliberate timing equalisation against user enumeration. The AES-256-GCM credential encryption is correctly constructed (fresh random IV per call, auth tag genuinely verified, key length enforced, working rotation). The Claude chat connector's tool surface — the obvious prompt-injection target — is read-only, workspace-scoped and re-checked server-side. Most of what follows is a short list of specific gaps in an otherwise careful codebase, not a systemic failure.

The worst finding is **1 Critical**: any authenticated member can delete arbitrary files on the server, outside the uploads directory, silently. Below that: **6 High**, **11 Medium**, **10 Low**. Two of the High findings are conditional on how production is actually deployed, which could not be determined from source and needs a direct answer from the team (see *Open questions* at the end).

The recurring theme across the real findings is **"one shared workspace"**. Every user is provisioned into the first `Workspace` row, so a query scoped only by `workspaceId` gives no isolation whatsoever between colleagues. Most routes correctly add an ownership or participant check on top; the ones that forgot are where the findings are.

---

## Critical

### [C-1] Any member can delete arbitrary files on the server (path traversal in `deleteUpload`)

- **Location:** `apps/web/src/lib/uploads.ts:80-88`, reachable from `apps/web/src/app/api/team-chat/messages/route.ts:13`
- **What's wrong:** `deleteUpload` accepts either an app-relative or an absolute URL. The absolute branch is normalised by `new URL()`, which collapses `..` segments. The relative branch is not normalised at all, and there is no containment check after the join — unlike the *serving* route, which correctly re-checks that the joined path stays under the uploads root.
- **Evidence:**
  ```ts
  export async function deleteUpload(url: string): Promise<void> {
    try {
      const pathname = url.startsWith('/') ? url : new URL(url).pathname;  // relative branch: no normalisation
      if (!pathname.startsWith('/uploads/')) return;
      await unlink(path.join(getUploadRoot(), pathname.slice('/uploads/'.length)));  // no containment check
    } catch {
      // Already gone, or an unparseable url — either way, nothing more to do.
    }
  }
  ```
  `/uploads/../../../../etc/passwd` passes the `startsWith('/uploads/')` gate, then `path.join` resolves the `..` segments straight out of the uploads root.
- **Why it's exploitable:** Three routes accept an attachment `url` as an unconstrained string (`url: z.string().min(1).max(2000)`) — team chat (`api/team-chat/messages/route.ts:13`), direct messages (`.../messages/route.ts:13`) and bug reports (`api/bug-reports/route.ts:11`). Three routes feed a stored `url` straight into `deleteUpload`. So: a plain member (no owner rights, no special role) posts a team-chat message whose attachment `url` is `/uploads/../../../../<anything>`, then deletes **their own** message — the author-only check passes, because it is genuinely their message. `unlink` then fires on a path of their choosing with the app process's permissions. The empty `catch` swallows the result, nothing is logged, and the caller still receives `200 {ok:true}`. Repeatable at will. Targets include other clients' scheduled-post media, avatars, `.env`, and build output; in the Docker layout the web container runs as root over `/data/uploads` and `/app`.
- **Fix direction:** In `deleteUpload`, normalise unconditionally and assert containment — resolve the joined path and require it to start with `getUploadRoot() + path.sep` before `unlink`, and log rather than swallow. Independently, tighten the three attachment schemas to a strict shape (`/^\/uploads\/[a-z-]+\/[0-9a-f-]{36}(\.[a-z0-9]{1,10})?$/`). Do both; either alone closes this instance, both close the class.

---

## High

### [H-1] Uploaded SVG/HTML can execute on the app's own origin (stored XSS) — depends on deployment

- **Location:** `apps/web/src/lib/uploads.ts:26` (upload root default) plus the three routes with no MIME allowlist: `api/uploads/team-chat/route.ts:18`, `api/uploads/direct-chat/route.ts:18`, `api/jobs/[id]/tasks/[taskId]/attachments/route.ts:26`
- **What's wrong:** Five of the eight upload routes pass an `allowedTypes` allowlist to `saveUpload`; these three pass only a 25 MB cap. `safeExtension` preserves any lowercase alphanumeric extension, so `.svg`, `.html` and `.js` survive onto disk. Separately, the upload root **defaults to inside the web root**:
  ```ts
  return getEnv().UPLOADS_DIR ?? path.join(process.cwd(), 'public', 'uploads');
  ```
- **Why it's exploitable:** The dedicated serving route (`app/uploads/[...path]/route.ts`) is safe on its own — its MIME map contains only images and video, so an `.svg` is served as `application/octet-stream`, which browsers download rather than render. But that route only runs when Next's static handler has not already claimed the path. With `UPLOADS_DIR` unset, files land in `apps/web/public/uploads/`, and Next's static handler serves them with the real extension-derived `Content-Type` (`image/svg+xml`, `text/html`) — in `next dev` via a live filesystem check per request, and in `next start` for everything present at boot. A member uploads `x.svg` containing a `<script>` tag to team chat, posts the link, and any colleague who opens it executes attacker script on the app origin with their session — session theft, and through it every API that victim can reach (including the owner's credential writes).
- **Severity note:** The shipped Docker `full` profile sets `UPLOADS_DIR: /data/uploads`, outside `public/`, which closes this. It is **Critical** if production runs natively (`pnpm dev` is documented as the day-to-day mode, and `next.config.ts:12` deliberately allows LAN and Tailscale dev origins) and **not exploitable** under the Docker profile. This is the single most important open question in this report.
- **Fix direction:** All three are cheap and independent, so do all three: add MIME allowlists to the three routes (or reject `svg|html|htm|xhtml|js|xml` in `safeExtension`); default the upload root to a directory outside `public/`; add `X-Content-Type-Options: nosniff`, `Content-Disposition: attachment` and `Content-Security-Policy: default-src 'none'; sandbox` to the serving route.

### [H-2] Every uploaded file is served without authentication

- **Location:** `apps/web/src/app/uploads/[...path]/route.ts`
- **What's wrong:** No `requireUser()` or `getSessionUser()` anywhere in the handler. Path traversal *is* correctly blocked (twice over — segment rejection before the join, containment check after), and filenames are random UUIDs, so URLs are unguessable. But they are permanent, `immutable`-cached, and the only control is knowledge of the URL.
- **Why it's exploitable:** Anyone who ever obtains a URL keeps access forever, including an offboarded employee. URLs leak routinely — browser history, `Referer` headers on outbound clicks, pasting into Slack/WhatsApp, and the absolute post-media URLs deliberately handed to Meta. What lands here includes direct-message attachments and bug-report screenshots, which are exactly the confidential material.
- **Fix direction:** Gate on the session, and for attachments on membership of the owning conversation/workspace.

### [H-3] Meta Page access token is sent in the URL query string on every GET

- **Location:** `packages/connectors/meta/src/graph-client.ts:36,42`
- **What's wrong:**
  ```ts
  params.set('access_token', token);
  const url = method === 'GET' ? `${BASE_URL}${path}?${params.toString()}` : `${BASE_URL}${path}`;
  ```
- **Why it's exploitable:** The client's long-lived Meta Page token is placed in a URL on every Graph `GET` — which happens on every worker sync tick and up to 24 times per Instagram post while polling. URLs are recorded by reverse proxies, TLS-terminating corporate proxies, and APM/error trackers, in a way request bodies and headers are not. Anyone with read access to egress logs — hosting provider, ops contractor, a compromised log shipper — recovers a working publish/delete token for every agency client without touching the database or `CREDENTIALS_KEY`, defeating the (otherwise correct) at-rest encryption entirely.
- **Fix direction:** Send `Authorization: Bearer <token>` instead, which the Graph API accepts and which this repo's own Notion client already does correctly (`notion-client.ts:66`).

### [H-4] Any member can rewrite or delete a colleague's time entries

- **Location:** `apps/web/src/app/api/jobs/[id]/time-entries/[entryId]/route.ts:25-29`, used at `:39` (PATCH) and `:73` (DELETE)
- **What's wrong:** The guard confirms the entry belongs to the job in the URL, but never that it belongs to the caller.
  ```ts
  async function requireEntry(jobId: string, entryId: string) {
    const entry = await prisma.timeEntry.findUnique({ where: { id: entryId } });
    if (!entry || entry.jobId !== jobId) throw new HttpError(404, strings.errors.notFound);
    return entry;   // entry.userId is never compared to user.id
  }
  ```
- **Why it's exploitable:** `GET /api/jobs/<jobId>/time-entries` returns every entry on the job with its id and user. A member then sends `PATCH /api/jobs/<jobId>/time-entries/<colleagueEntryId>` with `{"durationMinutes": 1}` and a colleague's six-hour record becomes one minute, or `DELETE` erases it. This is billable time at an agency. Every sibling route enforces authorship — job comments, team chat, DMs, agenda events all check it — so this is an oversight, not a design position.
- **Fix direction:** Scope the query by `userId: user.id` (or add the explicit 403), matching the sibling routes.

### [H-5] Google sign-in fails open when `ALLOWED_EMAIL_DOMAIN` is unset

- **Location:** `apps/web/src/auth.ts:135-139`, with `allowDangerousEmailAccountLinking: true` at `:79` and auto-provisioning at `:32-40,52-58`
- **What's wrong:** The domain restriction is the entire gate on who may sign in with Google, and it is an optional environment variable with no runtime assertion:
  ```ts
  const domain = process.env.ALLOWED_EMAIL_DOMAIN?.trim().toLowerCase();
  if (!domain) return true;   // no domain configured → allow anyone
  ```
- **Why it's exploitable:** If that variable is ever missing, misspelled or dropped during a deploy, any Google account on the internet can sign in. The wrapped adapter then creates the user in `defaultWorkspaceId()` — the *first* workspace, i.e. the real one — and `getVisibleTabs` grants the defaults: chat, jobs, tables, connectors, automations. A stranger lands inside the company workspace with read access to the job board, data tables and team chat, with no alert and no second gate. The failure is silent and indistinguishable from normal operation.
- **Fix direction:** Fail closed — if the provider is Google and no domain is configured, deny, and require an explicit opt-in variable to allow any domain. Better still, assert the variable at boot alongside the other required env.

### [H-6] Postgres and Redis published on all host interfaces with trivial credentials

- **Location:** `docker-compose.yml` (ports `5432:5432`, `6379:6379`; `POSTGRES_USER/PASSWORD: eve/eve`; Redis unauthenticated)
- **What's wrong:** Both datastores bind every host interface, not `127.0.0.1`, in the same file used by `stack:up` — which the file itself describes as running "tudo como em producao".
- **Why it's exploitable:** `scripts/remote-access/REMOTE-ACCESS.md` states plainly that this machine holds `CREDENTIALS_KEY`, `AUTH_SECRET` and every client's ad tokens — "esta maquina e a chave do cofre". Anyone who reaches the office LAN connects to Postgres as `eve:eve` and reads or modifies the entire database, bypassing every application-layer control in this report. Redis (sessions' rate limits, chat history, SSE pub/sub) has no password at all.
- **Fix direction:** Bind to `127.0.0.1:5432` / `127.0.0.1:6379`, take the password from the environment, and set a Redis `requirepass`.

---

## Medium

### [M-1] Non-owners can repoint a credentialed connector and fire it
`apps/web/src/app/api/instances/[id]/route.ts:32-38`. Writing `credentials` is correctly gated on `canWriteCredentials`; writing `config` is gated by nothing. A member sends `PATCH /api/instances/<metaInstanceId>` with a new `config.pageId`, then `POST /api/instances/<id>/sync`, and the owner's stored Meta token is exercised against a target of their choosing — they never see the token, but they direct its use, and can read results back via `GET /api/instances/[id]/data` or publish through it via `POST /api/scheduling/posts`. **Fix:** require `canWriteCredentials` (or a new `canConfigureInstance`) whenever `connector.auth !== 'none'` and `config` is present; leave `label` open.

### [M-2] `pageId` is unconstrained and interpolated into the Graph API path
`packages/connectors/meta/src/connector.ts:8` (`z.string().min(1)`), consumed at `connector.ts:58` and `publish.ts:82`. Combined with M-1, a non-owner can set `pageId` to another Page the token can reach, or to a value containing `?` — e.g. `me/accounts?fields=access_token&x=` — which lets them choose the Graph endpoint *and* its parameters. The host is a fixed literal so this is path/parameter injection, not SSRF, and the sync path only keeps two fields; but the resulting Meta error is written verbatim to `statusMessage` (`core/sync.ts:45`) where every member can read it. **Fix:** `z.string().regex(/^\d{1,25}$/)` for both id fields, and fix M-1.

### [M-3] Data-table webhook tokens are readable and rotatable by every member
`apps/web/src/app/api/tables/route.ts:19` returns `webhookToken` in the list response to any authenticated user; `api/tables/[id]/webhook/route.ts:16,28` lets any member rotate or disable it with only `requireUser`. The codebase's own stated policy (`lib/permissions.ts:111`) is that the equivalent automations token is owner-only *because* it opens a public ingestion endpoint — and `api/automations/webhook` enforces exactly that. The table token opens the identical kind of endpoint and is treated as ordinary metadata. Any member can therefore write rows into any table from outside the app forever (the token survives offboarding), or rotate it and silently break every n8n/Zapier integration with no audit trail. **Fix:** drop `webhookToken` from the list `select`, and gate rotation on `canManageAutomations`/`requireOwner`.

### [M-4] A scheduling-tab user can destroy the workspace-wide client registry
`apps/web/src/app/api/scheduling/clients/[id]/route.ts:37-47` gates `DELETE` on `canViewScheduling` only, then hard-deletes. `Client` is cross-cutting: `Project.client` cascades (so project folders are deleted outright), while `Job`, `ScheduledPost`, `AgendaEvent` and **`FinancialEntry`** all `SetNull`. A user tagged `isSocialMedia` — which alone grants the scheduling tab — can irreversibly strip client attribution from Financeiro, a module they cannot even view. **Fix:** block the delete when dependent Projects/Jobs/FinancialEntries exist (the count-and-block pattern already used at `api/users/[id]/route.ts:198`), or gate destructive client management on `requireOwner`.

### [M-5] Raw exception messages are returned to the browser on 500
`apps/web/src/lib/api.ts:23` — `return fail(500, errorMessage(error))`. The doc comment claims this stops "a stack trace leaking to the browser": it stops the stack, but ships the message. Prisma's `PrismaClientKnownRequestError.message` names the model, field and constraint, and `PrismaClientValidationError` embeds a rendered copy of the query including argument values. Several routes also forward third-party text verbatim (Anthropic errors at `instances/[id]/chat/route.ts:109`, Meta Graph errors at `scheduling/posts/[id]/route.ts:62,70,96`). **Fix:** return a fixed string on the 500 branch; keep `errorMessage(error)` in the `console.error` only.

### [M-6] Automation logs — arbitrary third-party payloads — are readable by every member
`apps/web/src/app/api/automations/route.ts:8-16` requires only a session and returns the last 200 `AutomationLog` rows including `payload`, which is free-form JSON posted by whatever external system holds the (owner-only) token. n8n run payloads routinely carry API responses, customer records, sometimes credentials. Writing the token is owner-only by explicit policy; reading the results is open to everyone. **Fix:** gate the read with `canManageAutomations`, or redact `payload` for non-owners.

### [M-7] `assertMediaUrlIsPublic` does not block what its name implies
`packages/connectors/meta/src/publish.ts:19-35,46-67`. It correctly blocks `169.254.169.254`, all RFC1918 ranges, `localhost`, and — via WHATWG URL normalisation — decimal/octal/hex IPv4 encodings. It does **not** block `[::]`, ULA `[fd00::]`, link-local `[fe80::]`, v4-mapped `[::ffff:169.254.169.254]`, internal DNS names like `metadata.google.internal` or `127.0.0.1.nip.io`, or redirects to any of the above. **Today this reaches nothing**: every caller passes the URL to Meta as a parameter for *Meta's* servers to fetch; nothing in `apps/web` or `apps/worker` fetches it server-side. This is a latent SSRF that activates the moment anyone adds a thumbnailer, dimension probe or HEAD check. **Fix:** either rename/comment it honestly as a UX pre-check, or make it real (reject IPv6 except an allowlist, resolve DNS and re-check each address, re-check after redirects).

### [M-8] Bug reports are accepted, confirmed to the user, and read by nobody
`apps/web/src/lib/bug-report-email.ts:22` is a stub that logs and returns `false`; `api/bug-reports/route.ts:38-46` skips the `emailedAt` stamp accordingly and still returns `201 {ok:true}`. There is no read endpoint and no UI anywhere that displays `BugReport` rows. The feature built to catch problems is itself silently broken: users file reports, see success, and the rows sit in a table nobody reads. **Fix:** wire a provider or surface the rows in an owner-only view, and stop reporting success for an undelivered report.

### [M-9] Timer start/stop failures are invisible to the user and to monitoring
`apps/web/src/components/TimerProvider.tsx:55-89`. Both `startTimer` and `stopTimer` clear local state first, then fire the request inside `void (async () => …)` with a `catch` that ignores errors *and* no branch at all for a non-`ok` response. Either way the UI shows the timer stopped while the server still has an open entry (or never started one). At an agency this is billable client time, silently wrong, with nothing for monitoring to catch. **Fix:** restore `runningEntry` and surface an error on both the throw and the `!response.ok` path.

### [M-10] User-content route sets no `nosniff`, `Content-Disposition` or CSP
`apps/web/src/app/uploads/[...path]/route.ts:57-66`. The MIME allowlist makes this safe today in isolation, but the standard hardening for a user-content route is absent, which is what leaves H-1 depending entirely on deployment layout. **Fix:** add all three headers.

### [M-11] Login throttle is keyed on email only, and fails open
`apps/web/src/lib/rate-limit.ts:29-36`. Failing open when Redis is down is deliberate and documented (a hanging login form is worse), but brute-force protection then disappears entirely with only a `console.error` as signal. Independently, the key is the email address alone with no IP dimension, so password spraying — one attempt against each of many accounts — is never throttled. The two public webhook ingestion endpoints have no rate limiting at all. **Fix:** add an IP dimension, and emit a metric when the limiter fails open.

---

## Low / Notes

- **[L-1] Attachment `url` fields are unvalidated free-form strings** — `api/team-chat/messages/route.ts:13`, `api/direct-messages/.../messages/route.ts:13`, `api/bug-reports/route.ts:11`, unlike `api/profile/route.ts:18` which constrains the shape. This is the input half of C-1; independently it allows a link whose visible label reads `relatorio-financeiro.pdf` while the href points anywhere — phishing inside the team chat. It is **not** XSS: React 19 blocks `javascript:` hrefs (verified in the installed `react-dom@19.3.0`), and browsers block top-level `data:` navigation.
- **[L-2] `agenda/events` accepts `clientId` with no existence or workspace check** — `agenda/events/[id]/route.ts:60`, `agenda/events/route.ts:83`. Attendee ids in the same routes *are* validated, and the financial routes validate both `clientId` and `jobId`, so this is an inconsistency rather than a pattern. Worst case today is the FK error of M-5.
- **[L-3] `scheduling/posts/[id]` PATCH skips the media-URL check** that POST applies (`scheduling/posts/[id]/route.ts:46` vs `scheduling/posts/route.ts:132`).
- **[L-4] No AAD binds a credential ciphertext to its instance** — `packages/core/src/crypto.ts:47-53`. An attacker with database write could move one workspace's encrypted token onto another workspace's instance row and it would decrypt cleanly. Low, because database write is already game over.
- **[L-5] Worker media cleanup silently no-ops if the working directory is wrong** — `apps/worker/src/media-cleanup.ts:15` resolves the upload root from `process.cwd()` at module load. Started from the repo root instead of `apps/worker`, every `unlink` throws `ENOENT` into a `catch {}`, `removed` stays 0, and the disk grows forever with no signal.
- **[L-6] No upload quota** — any member can loop 200 MB post-media uploads until the volume fills, which in the single-volume compose layout takes Postgres and Redis down with it.
- **[L-7] Chat history silently falls back to per-process memory** — `packages/connectors/chat/src/store.ts:52-56` reads `process.env.REDIS_URL` directly, bypassing `getEnv()` and its default, so conversations vanish on deploy with no error shown.
- **[L-8] Optimistic notification writes never report failure** — `NotificationsWorkspace.tsx:49,58`, `NotificationBell.tsx:180,190`.
- **[L-9] The `team` tab grants a page with no backing API** — `lib/permissions.ts:121` promises a role-granted read-only roster, but the only roster endpoint (`GET /api/users`) is owner-only, so such a user reaches a page whose data call 403s. The failure is in the safe direction; noted so nobody "fixes" it by loosening `/api/users`, which also returns `hasPassword` and `disabled`.
- **[L-10] The disabled-user session path is correct but load-bearing and implicit** — `auth.ts:172` returns the session unchanged for a disabled or deleted user, which logs them out *only because* Auth.js's JWT-strategy session has no `id` (verified in `@auth/core@0.41.3/lib/actions/session.js:38`) and `getSessionUser` checks for one. Adding the near-universal `session.user.id = token.sub` snippet would silently convert this into a hole: the user would gain an `id` while `workspaceId` stayed `undefined`, and `where: { workspaceId: undefined }` in Prisma means *no filter*, i.e. every row. **Make this explicit** with a `return null` and a regression test.

---

## Google OAuth status

**Login works end to end** — nothing is broken in the flow. Both providers are wired: Credentials (argon2id, rate-limited, timing-equalised) and Google. The Google button only renders when `AUTH_GOOGLE_ID`/`AUTH_GOOGLE_SECRET` are both set (`login/page.tsx:21`), so a fresh clone does not show a button that cannot work. Redirect URI is the Auth.js standard `/api/auth/callback/google`, documented in `.env.example`. `trustHost: true` with `AUTH_URL` deliberately empty means the callback follows the request host, which is what makes LAN/Tailscale access work.

**CSRF `state` is handled** — Auth.js v5 performs state and PKCE validation internally for OAuth providers; there is no missing check here, and no hand-rolled callback handler to get it wrong. Client secret is server-side only (no `NEXT_PUBLIC_` variables anywhere).

The one real issue is **H-5**: the domain restriction that makes `allowDangerousEmailAccountLinking: true` safe is an optional env var that fails open. The linking flag itself is a reasonable trade-off *while* the domain check is active — Google verifies address ownership for Workspace domains — but the two are coupled and only one of them is enforced.

Sign-in correctly refuses disabled accounts for every provider (`auth.ts:121-129`), and `session()` re-reads the user from the database on every request, so revoking `isOwner` takes effect immediately rather than at JWT expiry.

## Dashboard module inventory

| Module | Status | Notes |
|---|---|---|
| Jobs (kanban), job detail, tasks, comments | working | real APIs, correctly scoped |
| Timesheet | working, **silently unreliable** | M-9; and H-4 lets anyone edit anyone's entries |
| Projects, Clients | working | |
| Financial | working | permission-gated, `clientId`/`jobId` validated — the best-validated area in the codebase |
| Tables (user-defined columns) | working | row keys whitelisted against stored columns; no dynamic SQL |
| Scheduling calendar + post editor | working | live Meta publishing |
| Agenda | working | L-2 |
| Team chat / Direct messages | working | DM participant checks verified correct |
| Notifications | working | per-user scoped correctly; D-4/L-8 on failed writes |
| Connectors | working | M-1 |
| Settings, Canvas board | working | |
| SSE event stream | working | Redis pub/sub, workspace-filtered, 25 s heartbeat |
| Automations | **partial by design** | webhook ingestion + read-only log feed; no workflow builder (stated in the component) |
| Bug reports | **write-only, effectively broken** | M-8 — accepted, confirmed, never delivered or displayed |
| Worker: sync, snapshot prune, scheduling tick | working | BullMQ with jitter and backoff |
| Worker: media cleanup | working, fragile | L-5 |

## Widget/plugin connector status

The connector system is **schema-validated, not trusted**. Every connector declares a real zod `configSchema`, and `loadConnectorContext` re-parses the stored config *and* the decrypted credentials on every use rather than trusting the database row — throwing instead of falling back to defaults. The registry is a `Map` keyed by string under a `Symbol.for` global, so `__proto__`/`constructor` lookups return `undefined`; connectors are registered by static imports, with no dynamic `import()` of any user-controlled path.

Live: `meta` (Graph API), `notion` (read/write/undo), `chat` (Anthropic), `notes` (Redis-backed). Demo-only: `demo`. **Stubs by design:** `calculator`, `overview`, `calendar` — each returns `{ok:true, data:null}` from `sync()` and is a UI-only widget; `CalendarWidget.tsx:8` says so explicitly.

The one weak schema is Meta's `pageId` (M-2). Notion's `databaseId` is the model to copy — it is normalised and hard-matched against `/^[0-9a-fA-F]{32}$/`, which makes path injection impossible.

The **Claude chat connector's tool surface was audited specifically for prompt injection and is sound**: six read-only tools, no write/fetch/file/shell tool, every query filtered on the session's `workspaceId` (never on model-supplied input), the financial tool both withheld from the list *and* re-checked in the executor, `switch` dispatch with a default case, server-side limit clamping, and a 5-round cap. The worst a prompt-injected response achieves is reading rows the user could already read.

## Verified correct (explicit negative results)

Stated so these are not re-litigated later: no raw SQL anywhere (`$queryRaw`/`$executeRaw`/`*Unsafe` return zero hits repo-wide); no server actions; no `eval`/`new Function`/`dangerouslySetInnerHTML`; no committed secrets; no `NEXT_PUBLIC_` variables; every one of the 68 routes authenticates; no route accepts a client-supplied `workspaceId`/`authorId`/`ownerId`; no mass assignment (no `...body` spread into Prisma); the parent/child ID trap is correctly avoided everywhere (tasks, comments, rows, attachments and DMs all re-verify the child against its parent); `requireInstance` genuinely enforces workspace ownership; argon2id at OWASP parameters with timing equalisation; AES-256-GCM with a fresh 12-byte random IV per call, auth tag genuinely verified, 32-byte key enforced with no weak fallback, working rotation and no request-forceable downgrade; credentials never logged, returned, or placed in an error message; the uploads *serving* route blocks traversal twice over; worker media-cleanup traversal is unreachable because `mediaUrl` is `z.string().url()`; React 19 blocks `javascript:` hrefs; all 16 pages call `getSessionUser()` and redirect. One `TODO`, zero `@ts-ignore`, zero `as any` in first-party code.

## Not checked / out of scope this run

- **No live testing.** Every finding is from static source review. No payload was sent to any deployment, so exploitability is argued from code, not demonstrated.
- **The actual production deployment.** H-1's severity turns entirely on whether production runs the Docker `full` profile (safe) or natively (exploitable), and on whether `UPLOADS_DIR` is set there. This could not be determined from the repository.
- **Dependency/supply-chain audit.** No `pnpm audit` or CVE review of the ~lockfile was performed.
- **Frontend rendering sites** beyond the specific link/`linkify` paths traced for XSS.
- **Infrastructure outside the repo** — the host's firewall, Tailscale ACLs, TLS termination, backups.
- **The `.github/workflows/ci.yml` hardcoded `AUTH_SECRET`/`CREDENTIALS_KEY`** are clearly labelled CI-only dummies and are not a finding.

## Open questions for the team

1. **Does production run the Docker `full` profile, or natively?** And is `UPLOADS_DIR` set there? This decides whether H-1 is Critical or not exploitable.
2. **Is `ALLOWED_EMAIL_DOMAIN` currently set in the production `.env`?** (H-5.)
3. **Are ports 5432/6379 reachable from anything other than the host itself?** (H-6.)
