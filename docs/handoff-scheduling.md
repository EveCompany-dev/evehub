# Handoff: make post publishing reliable

Written 2026-09-24 for the agent that picks this up. Everything you need is in
this file and the code it points to; no earlier conversation is required.

## Goal

A post scheduled in Eve Hub goes out **exactly once**, at its time, and when it
can't, a person finds out. Today three things break that: posts stuck in
`publishing` are never retried, publishing depends entirely on the worker with
no signal when it is down, and a few paths can publish the same post twice.

Done means: every bug below is fixed, each with a test, `pnpm lint`,
`pnpm typecheck`, `pnpm test` (including the `*.db.test.ts` files against a
real Postgres) and `pnpm --filter @eve/web build` pass, and the UI tells people
the truth about a post's state.

## How publishing works today

Repo: `EveCompany-dev/evehub`, pnpm monorepo, Next.js 16 app in `apps/web`,
BullMQ worker in `apps/worker`, Prisma 7 + Postgres, Redis.

Model: `ScheduledPost` in `infra/prisma/schema.prisma`. One row per destination
(IG feed, IG story, IG reel, FB feed, FB story). Relevant fields: `status`
(`draft | scheduled | publishing | published | failed`), `statusMessage`,
`scheduledFor`, `metaCreationId` (IG container id), `metaPostId` (published
media/post id), `permalink`, `mediaUrl`, `mediaUrls` (IG carousel, 2-10
images), `contentRowId` (its row on the client's Calendario de Conteudo),
`updatedAt`.

Creating (`apps/web/src/app/api/scheduling/posts/route.ts`, POST):
- **Facebook feed** is scheduled natively: the route calls
  `scheduleFacebookPost` right away with a future `scheduled_publish_time`
  (Meta requires 10 min to 75 days ahead) and stores `metaPostId`. So FB feed
  can never be "Postar agora".
- **Everything else** (IG feed/carousel/story/reel, FB story) is stored as
  `scheduled` with no Meta call. The worker publishes it later.
- The UI is `apps/web/src/components/PostComposer.tsx`. "Postar agora" just
  sends `scheduledFor = now` (see `run(now)` around line 411), then shows
  "Post enviado para publicação." and waits for the worker.

Publishing (`apps/worker/src/scheduling.ts`, `processDuePosts`), called by the
`scheduling-tick` job every 60 s (`apps/worker/src/index.ts`):
1. Instagram: `findMany({ status: 'scheduled', scheduledFor <= now })`, then
   per post: unconditional `update` to `publishing`, create the container(s),
   save `metaCreationId`, `pollInstagramContainerReady` (images 12 x 5 s,
   video 24 x 5 s), `publishInstagramContainer` (`media_publish`), then
   `markPublished` (fetch permalink, status `published`, refresh the content
   row) or `markFailed` (status `failed`, notify the author). A 20 s gap is
   kept between two posts to the same IG account within one tick.
2. Facebook feed: only reconciles; `checkFacebookPostStatus`, marks
   `published`, or `failed` after a 15 min grace.
3. Facebook story: `publishFacebookStory` (immediate), same mark functions.

Meta helpers: `packages/connectors/meta/src/publish.ts` and `graph-client.ts`
(20 s request timeout; token sent as a header). The content calendar row
follows the post via `refreshContentRow` in `packages/core/src/content-posts.ts`.

Editing/deleting: `apps/web/src/app/api/scheduling/posts/[id]/route.ts`. PATCH
only allows `draft`/`scheduled`; a `failed` post can't be edited or retried,
so the composer offers "start a new one with the same content" (new row).

## The bugs

1. **Stuck in `publishing` forever.** The tick only selects `scheduled`. If the
   worker dies, restarts or deploys while a post is `publishing` (easy: a
   video poll alone runs ~2 min), nobody touches that row again and nobody is
   told. It also sits in the calendar as "Programado".
2. **Overlapping ticks can double-post.** The tick job repeats every 60 s on a
   worker with `concurrency: 4`, and a tick routinely runs longer than 60 s
   (container polling plus the 20 s same-account gaps). A second tick then
   reads the same `scheduled` rows that the first tick has not reached yet,
   and both publish them. The claim is an unconditional `update`, so nothing
   stops it.
3. **Publishing needs the worker, silently.** With the worker down, "Postar
   agora" says "enviado para publicação" and nothing ever happens; scheduled
   posts just stay `scheduled`. There is no health signal anywhere.
4. **Timeout after Meta accepted = duplicate on retry.** If `media_publish`
   (or `publishFacebookStory`) times out on our side but Meta accepted it, the
   row is marked `failed` although the post is live. The only retry path is a
   new row, which posts again.
5. **A `metaCreationId` is never reused.** A retried IG post creates a new
   container instead of checking the one it already made; if that container
   was already `PUBLISHED`, the code should record it as published, not
   create and publish again.
6. **No retry for a failed post** (see PATCH above). Retrying should reuse the
   same row, so the content calendar and history stay one line.

## Suggested design (a starting point, not a mandate)

An earlier attempt existed on a branch that has since been deleted (it was
written against the old `PostEditor`, before `PostComposer` and content rows).
Its ideas were sound and fit the current code:

- **One publish function** in `@eve/core` (for example
  `packages/core/src/publish-post.ts`), used by both the worker and a new
  `POST /api/scheduling/posts/[id]/publish` route. Move the per-post logic out
  of `apps/worker/src/scheduling.ts`; keep the worker as a loop over due rows.
- **Conditional claim** so two runners never publish one row: `updateMany`
  with `where: { id, OR: [{ status: { in: ['scheduled', 'failed'] } },
  { status: 'publishing', updatedAt: { lt: now - 5 min } }] }`, proceed only
  when `count === 1`. The stale `publishing` branch fixes bug 1; the
  condition itself fixes bug 2.
- **Re-entrant steps**: save `metaCreationId` right after creating a container
  and reuse it on the next run (check its `status_code` first: `PUBLISHED`
  means done, `FINISHED` means publish it, `EXPIRED`/`ERROR` means start over);
  never publish a row that already has `metaPostId`.
- **After a failed `media_publish`**, re-query the container; if Meta says
  `PUBLISHED`, record it as published (bug 4). For FB stories there is no
  container, so treat a timeout as "unknown" and check the Page's recent
  stories before failing, or at least say "may have been published" in the
  message.
- **"Postar agora" publishes in the request** through the same function and
  returns the real outcome (published, still processing, or Meta's error). If
  a video is still processing, leave the row claimable and let the worker
  finish it; the composer must then close, not invite another click (a second
  click creating a second row was exactly how the old attempt produced
  duplicates).
- **Worker heartbeat**: the tick writes a Redis key with a TTL (the old attempt
  used `eve:worker:heartbeat`, 300 s); a small API route reads it and the
  composer / content calendar show a warning when it is missing (bug 3).
- **Retry in place**: allow PATCH (or the publish route) on `failed` rows,
  reusing the row (bug 6).
- Also consider serializing the tick itself (one tick at a time, e.g. a
  separate queue with concurrency 1 or a Redis lock) as a second guard.

## Things to keep

- The 20 s same-account spacing for IG (Meta treats bursts as automation).
- `assertMediaUrlIsPublic` before any container is created.
- `markFailed`'s notification to the author, and `refreshContentRow` after
  every status change (the content calendar's Status follows the post).
- Facebook feed stays natively scheduled; only its reconciliation moves.
- Activity log entries (`logActivity`) for anything a person does in the API.
- Strings shown to users are pt-BR; code and comments are English.

## Testing

- Unit tests for the publish function with the Meta helpers mocked: claim
  race (two concurrent calls, one publishes), stale `publishing` reclaimed,
  existing `metaCreationId` reused, `PUBLISHED` container recorded without a
  second `media_publish`, timeout-then-published case, `metaPostId` present
  means no call.
- A `*.db.test.ts` for the conditional claim against real Postgres (follow
  `apps/web/src/lib/authz.db.test.ts` for the pattern; these skip without a
  database and run in CI, which has Postgres and Redis).
- Existing tests: `packages/connectors/meta/src/publish.test.ts`.

## Out of scope

Anything else in scheduling (new destinations, Facebook multi-photo, editing
live posts). Leave unrelated code alone.
