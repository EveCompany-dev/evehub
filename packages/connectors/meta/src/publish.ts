import { graphRequest, MetaGraphError } from './graph-client';

/**
 * Real publish calls against Meta's Graph API — used directly by the
 * scheduling API routes (apps/web/src/app/api/scheduling) and the worker's
 * SCHEDULING_TICK job, not through the connector's SDK-declared methods.
 *
 * Facebook has native scheduling (`published=false` + `scheduled_publish_time`)
 * — Meta's own infrastructure fires it, we only reconcile status afterward.
 * Instagram has no equivalent, so publishing there is a real two-step
 * container-then-publish call fired by our own worker at the scheduled time.
 */

export interface FacebookScheduleResult {
  postId: string;
}

export async function scheduleFacebookPost(
  token: string,
  pageId: string,
  imageUrl: string,
  caption: string,
  scheduledForUnixSeconds: number,
): Promise<FacebookScheduleResult> {
  const response = await graphRequest<{ id: string; post_id?: string }>(token, `/${pageId}/photos`, {
    method: 'POST',
    params: {
      url: imageUrl,
      caption,
      published: false,
      scheduled_publish_time: scheduledForUnixSeconds,
    },
  });

  // A photo post's `post_id` is the actual feed post id; `id` alone is the
  // photo object. Prefer post_id when present so status checks/deletes hit
  // the right object.
  return { postId: response.post_id ?? response.id };
}

export async function checkFacebookPostStatus(token: string, postId: string): Promise<{ isPublished: boolean }> {
  const response = await graphRequest<{ is_published?: boolean }>(token, `/${postId}`, {
    params: { fields: 'is_published' },
  });
  return { isPublished: Boolean(response.is_published) };
}

/** Cancels a not-yet-published scheduled Facebook post. */
export async function deleteFacebookPost(token: string, postId: string): Promise<void> {
  await graphRequest(token, `/${postId}`, { method: 'DELETE' });
}

export interface FacebookStoryResult {
  postId: string;
}

/**
 * Facebook Page Stories have no native scheduling — `/photo_stories` publishes
 * immediately on call, unlike `/photos` with `scheduled_publish_time`. The
 * worker has to fire this itself at the scheduled time, same pattern as
 * Instagram, rather than submitting ahead of time like scheduleFacebookPost.
 */
export async function publishFacebookStory(token: string, pageId: string, imageUrl: string): Promise<FacebookStoryResult> {
  const photo = await graphRequest<{ id: string }>(token, `/${pageId}/photos`, {
    method: 'POST',
    params: { url: imageUrl, published: false },
  });

  const story = await graphRequest<{ post_id?: string; id?: string }>(token, `/${pageId}/photo_stories`, {
    method: 'POST',
    params: { photo_id: photo.id },
  });

  return { postId: story.post_id ?? story.id ?? photo.id };
}

export interface InstagramContainerResult {
  creationId: string;
}

export async function createInstagramContainer(
  token: string,
  igUserId: string,
  imageUrl: string,
  caption: string,
): Promise<InstagramContainerResult> {
  const response = await graphRequest<{ id: string }>(token, `/${igUserId}/media`, {
    method: 'POST',
    params: { image_url: imageUrl, caption },
  });
  return { creationId: response.id };
}

/**
 * Same container as a feed post, but `media_type: 'STORIES'` and no caption —
 * the Stories endpoint doesn't accept one. Reuses `pollInstagramContainerReady`
 * and `publishInstagramContainer` below unchanged, since neither cares which
 * media_type produced the container.
 */
export async function createInstagramStoryContainer(
  token: string,
  igUserId: string,
  imageUrl: string,
): Promise<InstagramContainerResult> {
  const response = await graphRequest<{ id: string }>(token, `/${igUserId}/media`, {
    method: 'POST',
    params: { image_url: imageUrl, media_type: 'STORIES' },
  });
  return { creationId: response.id };
}

const POLL_ATTEMPTS = 12;
const POLL_DELAY_MS = 5_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Container creation is asynchronous by contract even for images. Polls
 * `status_code` until the container is ready, rather than calling
 * `media_publish` on one that isn't.
 *
 * The budget (12 × 5s ≈ 55s of waiting) is deliberately under the worker's
 * 60s SCHEDULING_INTERVAL_MS: a large image routinely takes longer than a
 * couple of seconds, and the old 6 × 2s ≈ 12s budget failed those posts for
 * being slow rather than broken. Re-entrancy is safe either way — the row is
 * flipped to `publishing` before we get here and the due-post query only
 * picks up `scheduled` ones.
 */
export async function pollInstagramContainerReady(token: string, creationId: string): Promise<void> {
  for (let attempt = 0; attempt < POLL_ATTEMPTS; attempt += 1) {
    const response = await graphRequest<{ status_code?: string }>(token, `/${creationId}`, {
      params: { fields: 'status_code' },
    });

    // PUBLISHED means a previous run already got it live — treat it as done
    // instead of falling through to a second media_publish call.
    if (response.status_code === 'FINISHED' || response.status_code === 'PUBLISHED') return;
    if (response.status_code === 'ERROR') {
      throw new MetaGraphError('O Instagram rejeitou o processamento da midia.', 422);
    }
    if (response.status_code === 'EXPIRED') {
      throw new MetaGraphError('O container do Instagram expirou antes de ser publicado.', 410);
    }

    // No sleep after the final look: it would only delay the error below.
    if (attempt < POLL_ATTEMPTS - 1) await sleep(POLL_DELAY_MS);
  }

  throw new MetaGraphError('O container do Instagram não ficou pronto a tempo.', 504);
}

export async function publishInstagramContainer(
  token: string,
  igUserId: string,
  creationId: string,
): Promise<{ mediaId: string }> {
  const response = await graphRequest<{ id: string }>(token, `/${igUserId}/media_publish`, {
    method: 'POST',
    params: { creation_id: creationId },
  });
  return { mediaId: response.id };
}
