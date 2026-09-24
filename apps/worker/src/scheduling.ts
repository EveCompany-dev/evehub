import { loadConnectorContext, markFailed, markPublished, prisma, publishPost, STALE_PUBLISHING_MS, type MetaPublishApi, type PublishOutcome } from '@eve/core';
import { checkFacebookPostStatus, isMissingObjectError, metaPublishApi, type MetaCredentials } from '@eve/connector-meta';

const FACEBOOK_GRACE_MS = 15 * 60 * 1000;

/**
 * Gap enforced between consecutive publish calls TO THE SAME Instagram
 * account within one tick. Firing several posts back-to-back on the *same*
 * account reads to Meta like automation abuse and risks a temporary posting
 * block — a risk that scales with how many accounts a single agency
 * workspace like this one runs. Different accounts publish in the same tick
 * with no extra delay; only re-hitting one account is throttled.
 */
export const SAME_ACCOUNT_GAP_MS = 20_000;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface TickDeps {
  api?: MetaPublishApi;
  publish?: typeof publishPost;
  sleep?: (ms: number) => Promise<void>;
  /** Called before each post; the worker refreshes its heartbeat here so a long tick never looks dead. */
  onProgress?: () => Promise<void>;
}

export interface TickSummary {
  published: number;
  failed: number;
  processing: number;
  facebookFeedChecked: number;
}

/**
 * The due posts the worker itself publishes: every Instagram post and every
 * Facebook story that is due and `scheduled`, plus any `publishing` row left
 * behind by a runner that died. Only ids are read here — publishPost claims
 * each one and reads it fresh, so an edit or a reschedule made while this
 * tick was sleeping between posts is what goes out (or is left alone).
 */
async function dueForPublishing(now: Date) {
  return prisma.scheduledPost.findMany({
    where: {
      NOT: { platform: 'facebook', postType: 'feed' },
      scheduledFor: { lte: now },
      OR: [{ status: 'scheduled' }, { status: 'publishing', updatedAt: { lt: new Date(now.getTime() - STALE_PUBLISHING_MS) } }],
    },
    select: { id: true, platform: true, connectorInstanceId: true },
    orderBy: { scheduledFor: 'asc' },
  });
}

/**
 * Facebook feed posts were submitted to Meta at creation time (native
 * `scheduled_publish_time`); this only reconciles our record with what Meta
 * did. An error while asking counts toward the same grace period as "not
 * published yet": an expired token or a post deleted in Business Suite must
 * end as `failed` with a notification, not sit in `scheduled` forever.
 */
async function reconcileFacebookFeed(now: Date, api: MetaPublishApi, onProgress?: () => Promise<void>): Promise<number> {
  const due = await prisma.scheduledPost.findMany({
    where: { platform: 'facebook', postType: 'feed', status: 'scheduled', scheduledFor: { lte: now } },
    include: { connectorInstance: true },
  });

  for (const post of due) {
    await onProgress?.();
    try {
      // A due Facebook feed row with no metaPostId never reached Meta (the
      // scheduling call failed after the row was created): nothing to wait for.
      if (!post.metaPostId) {
        await markFailed(post, new Error('O post nao chegou a ser registrado no Meta. Edite o horário para agendar de novo.'));
        continue;
      }

      const pastGrace = now.getTime() - post.scheduledFor.getTime() > FACEBOOK_GRACE_MS;
      let credentials: MetaCredentials;
      try {
        credentials = loadConnectorContext(post.connectorInstance).ctx.credentials as MetaCredentials;
      } catch (error) {
        if (pastGrace) await markFailed(post, error);
        continue;
      }

      try {
        const { isPublished } = await checkFacebookPostStatus(credentials.pageAccessToken, post.metaPostId);
        if (isPublished) await markPublished(post, credentials.pageAccessToken, post.metaPostId, api);
        else if (pastGrace) await markFailed(post, new Error('O Meta nao confirmou a publicacao a tempo.'));
      } catch (error) {
        if (isMissingObjectError(error)) {
          await markFailed(post, new Error('O post não existe mais no Facebook: foi apagado ou cancelado pelo Meta Business Suite.'));
        } else if (pastGrace) {
          await markFailed(post, new Error(`Não deu para confirmar a publicação com o Meta: ${errorMessage(error)}`));
        } else {
          console.error(`[worker] falha ao checar status do post ${post.id} no Facebook:`, errorMessage(error));
        }
      }
    } catch (error) {
      // One post never takes the rest of the tick down with it.
      console.error(`[worker] falha ao reconciliar o post ${post.id}:`, errorMessage(error));
    }
  }
  return due.length;
}

/**
 * One scheduling tick: publish everything due, one post at a time, then
 * reconcile Facebook feed posts. Nothing about a single post can throw out of
 * this loop — a post that vanished mid-tick is skipped, one that fails is
 * marked `failed` and the loop moves on.
 */
export async function processDuePosts(deps: TickDeps = {}): Promise<TickSummary> {
  const api = deps.api ?? metaPublishApi;
  const publish = deps.publish ?? publishPost;
  const wait = deps.sleep ?? sleep;
  const now = new Date();
  const summary: TickSummary = { published: 0, failed: 0, processing: 0, facebookFeedChecked: 0 };

  const lastInstagramAttemptAt = new Map<string, number>();

  for (const candidate of await dueForPublishing(now)) {
    try {
      if (candidate.platform === 'instagram') {
        const last = lastInstagramAttemptAt.get(candidate.connectorInstanceId);
        if (last !== undefined) {
          const remaining = SAME_ACCOUNT_GAP_MS - (Date.now() - last);
          if (remaining > 0) await wait(remaining);
        }
      }
      await deps.onProgress?.();

      const outcome: PublishOutcome = await publish(candidate.id, api, { mode: 'due' });
      if (outcome.kind !== 'skipped' && candidate.platform === 'instagram') lastInstagramAttemptAt.set(candidate.connectorInstanceId, Date.now());
      if (outcome.kind === 'published') summary.published += 1;
      else if (outcome.kind === 'failed') summary.failed += 1;
      else if (outcome.kind === 'processing') summary.processing += 1;
    } catch (error) {
      console.error(`[worker] falha inesperada no post ${candidate.id}:`, errorMessage(error));
    }
  }

  try {
    summary.facebookFeedChecked = await reconcileFacebookFeed(now, api, deps.onProgress);
  } catch (error) {
    console.error('[worker] falha ao reconciliar os posts do Facebook:', errorMessage(error));
  }

  return summary;
}
