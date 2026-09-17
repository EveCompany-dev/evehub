import { prisma, publishScheduledPost, STALE_PUBLISHING_MS, touchWorkerHeartbeat } from '@eve/core';

/**
 * Gap enforced between consecutive publish calls TO THE SAME Instagram
 * account within one tick. Firing several posts back-to-back on the *same*
 * account reads to Meta like automation abuse and risks a temporary posting
 * block — a risk that scales with how many accounts a single agency
 * workspace like this one runs, not with any one user's intent. Different
 * accounts publish in the same tick with no extra delay; only re-hitting one
 * account is throttled.
 *
 * "Postar agora" no longer comes through here: it publishes inline in the
 * request (see publishScheduledPost's own doc for why) so that a stopped
 * worker cannot silently swallow it. One manual post is not a burst; this
 * still throttles the case that actually looks automated, which is a queue of
 * due posts firing together.
 */
const SAME_ACCOUNT_GAP_MS = 20_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface TickResult {
  published: number;
  failed: number;
  processing: number;
  /** Rows recovered from a `publishing` state whose run had been interrupted. */
  recovered: number;
}

/**
 * Every post that is due and not already live, including the ones a previous
 * run left mid-flight. The old query only looked for `scheduled`, which meant
 * a row flipped to `publishing` by a run that then died — a redeploy, a
 * crash, a container restart — was never looked at again by anyone: it sat
 * there forever, in a state no retry path covered. Publishing is re-entrant
 * now, so picking those back up is safe and is the difference between a
 * stuck post recovering on its own and a stuck post being lost.
 */
async function findDuePosts(now: Date) {
  const staleBefore = new Date(Date.now() - STALE_PUBLISHING_MS);

  return prisma.scheduledPost.findMany({
    where: {
      scheduledFor: { lte: now },
      OR: [{ status: 'scheduled' }, { status: 'publishing', updatedAt: { lt: staleBefore } }],
    },
    orderBy: { scheduledFor: 'asc' },
    select: { id: true, status: true, connectorInstanceId: true },
  });
}

export async function processDuePosts(): Promise<TickResult> {
  await touchWorkerHeartbeat();

  const due = await findDuePosts(new Date());
  const result: TickResult = { published: 0, failed: 0, processing: 0, recovered: 0 };
  const lastPublishAtByInstance = new Map<string, number>();

  for (const post of due) {
    if (post.status === 'publishing') result.recovered += 1;

    // Same account as whatever we just finished publishing? Wait out the rest
    // of the gap before touching it again — see SAME_ACCOUNT_GAP_MS.
    const last = lastPublishAtByInstance.get(post.connectorInstanceId);
    if (last !== undefined) {
      const remaining = SAME_ACCOUNT_GAP_MS - (Date.now() - last);
      if (remaining > 0) await sleep(remaining);
    }
    lastPublishAtByInstance.set(post.connectorInstanceId, Date.now());

    const outcome = await publishScheduledPost(post.id);
    if (outcome.status === 'published') result.published += 1;
    else if (outcome.status === 'processing') result.processing += 1;
    else if (outcome.status === 'failed') result.failed += 1;
  }

  return result;
}
