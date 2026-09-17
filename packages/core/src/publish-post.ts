import {
  assertMediaUrlIsPublic,
  checkFacebookPostStatus,
  ContainerNotReadyError,
  createInstagramCarouselContainer,
  createInstagramCarouselItemContainer,
  createInstagramContainer,
  createInstagramReelContainer,
  createInstagramStoryContainer,
  mediaKindFromUrl,
  pollInstagramContainerReady,
  publishFacebookStory,
  publishInstagramContainer,
  type MetaConfig,
  type MetaCredentials,
} from '@eve/connector-meta';
import { errorMessage, loadConnectorContext } from './connector-context';
import { prisma, type ConnectorInstance, type ScheduledPost } from './prisma';

/**
 * The one publish implementation in the codebase.
 *
 * It used to live inside the worker's tick loop, which made publishing
 * something only a separate background process could do: when that process
 * wasn't running, posts sat at `scheduled` past their time forever, with no
 * error, no retry and nothing in the UI to say so. Both the worker and the
 * "publicar agora" request path call this now, so a dead worker stops being
 * the difference between a post going out and disappearing.
 *
 * Re-entrancy is the property that makes two callers safe. Every step records
 * what it achieved on the row (`metaCreationId`, then `metaPostId`), so a run
 * that is interrupted anywhere — process death, a redeploy, an HTTP timeout —
 * is resumed rather than restarted by whoever runs next.
 */

/** A row left `publishing` for longer than this had its run interrupted; it is fair game again. */
export const STALE_PUBLISHING_MS = 5 * 60 * 1000;

/** Poll budget for the request path: long enough for a normal image, short enough to answer an HTTP call. */
const INLINE_POLL_ATTEMPTS = 6;

export type PublishOutcome =
  /** Live on Meta. `alreadyPublished` means a previous run had already done it. */
  | { ok: true; status: 'published'; metaPostId: string | null; alreadyPublished: boolean }
  /** Meta is still processing the media. The container is saved; running again resumes from it. */
  | { ok: true; status: 'processing'; message: string }
  /** Someone else (the worker, or another click) is publishing this row right now. */
  | { ok: false; status: 'busy'; message: string }
  | { ok: false; status: 'failed'; message: string };

type PostWithInstance = ScheduledPost & { connectorInstance: ConnectorInstance };

const TYPE_LABEL: Record<string, string> = { feed: 'post', story: 'story', reel: 'reel' };

/**
 * A post that fails is otherwise completely silent: it happens at a minute
 * nobody is watching, and all it leaves behind is a row that quietly turns
 * red in a calendar cell. Notifying whoever scheduled it is the only thing
 * that actually reaches a person — hence a notification alongside the status
 * write, not just the status write.
 */
async function markFailed(post: PostWithInstance, message: string): Promise<void> {
  await prisma.scheduledPost.update({
    where: { id: post.id },
    data: { status: 'failed', statusMessage: message.slice(0, 500) },
  });

  // Never let the notification be the reason the run dies: the status write
  // above is the part that must not be lost.
  try {
    const what = `${post.platform === 'instagram' ? 'Instagram' : 'Facebook'} ${TYPE_LABEL[post.postType] ?? post.postType}`;
    await prisma.notification.create({
      data: {
        workspaceId: post.workspaceId,
        userId: post.createdBy,
        type: 'scheduledPostFailed',
        message: `O ${what} de ${post.clientLabel} não foi publicado: ${message}`.slice(0, 500),
      },
    });
  } catch (cause) {
    console.error(`[publish] falha ao notificar erro do post ${post.id}:`, errorMessage(cause));
  }
}

/**
 * Takes ownership of the row by flipping it to `publishing`, but only from a
 * state that is actually free: not yet started, previously failed, or stuck
 * mid-flight long enough that whoever held it is plainly gone. The conditional
 * update is the lock — two callers racing means exactly one gets count 1, so
 * the worker's tick and a "publicar agora" click can never both publish the
 * same post.
 */
async function claim(postId: string): Promise<boolean> {
  const { count } = await prisma.scheduledPost.updateMany({
    where: {
      id: postId,
      OR: [
        { status: { in: ['draft', 'scheduled', 'failed'] } },
        { status: 'publishing', updatedAt: { lt: new Date(Date.now() - STALE_PUBLISHING_MS) } },
      ],
    },
    data: { status: 'publishing' },
  });
  return count === 1;
}

/** Creates the Instagram container for this post, or reuses the one a previous run already made. */
async function ensureInstagramContainer(
  post: PostWithInstance,
  credentials: MetaCredentials,
  igUserId: string,
): Promise<string> {
  if (post.metaCreationId) return post.metaCreationId;

  // Carrossel: 2-10 imagens em mediaUrls (ver PostEditor's carousel mode).
  // Sempre feed — Stories e Reels nunca tem mediaUrls preenchido.
  const carouselUrls = Array.isArray(post.mediaUrls)
    ? (post.mediaUrls as unknown[]).filter((url): url is string => typeof url === 'string')
    : null;

  let creationId: string;

  if (carouselUrls && carouselUrls.length >= 2) {
    carouselUrls.forEach(assertMediaUrlIsPublic);

    // Each slide is its own container that has to finish processing before it
    // can be referenced as a carousel child — same asynchronous contract as a
    // standalone post's container, just one per slide instead of one.
    const childIds: string[] = [];
    for (const url of carouselUrls) {
      const { creationId: childId } = await createInstagramCarouselItemContainer(
        credentials.pageAccessToken,
        igUserId,
        url,
      );
      await pollInstagramContainerReady(credentials.pageAccessToken, childId, 'image');
      childIds.push(childId);
    }

    creationId = (
      await createInstagramCarouselContainer(credentials.pageAccessToken, igUserId, childIds, post.caption)
    ).creationId;
  } else {
    // Cheaper and far clearer than letting Meta fail the fetch itself.
    assertMediaUrlIsPublic(post.mediaUrl);

    creationId = (
      post.postType === 'story'
        ? await createInstagramStoryContainer(credentials.pageAccessToken, igUserId, post.mediaUrl)
        : post.postType === 'reel'
          ? await createInstagramReelContainer(credentials.pageAccessToken, igUserId, post.mediaUrl, post.caption)
          : await createInstagramContainer(credentials.pageAccessToken, igUserId, post.mediaUrl, post.caption)
    ).creationId;
  }

  // Saved before the wait that follows: this is the whole reason an
  // interrupted run can be resumed instead of creating a second container
  // (and, once published, a second post).
  await prisma.scheduledPost.update({ where: { id: post.id }, data: { metaCreationId: creationId } });
  return creationId;
}

async function publishInstagram(
  post: PostWithInstance,
  config: MetaConfig,
  credentials: MetaCredentials,
  pollAttempts: number | undefined,
): Promise<PublishOutcome> {
  if (!config.instagramBusinessAccountId) {
    throw new Error('Instancia do Meta sem ID da conta do Instagram configurado.');
  }
  const igUserId = config.instagramBusinessAccountId;

  // Already live. A row can reach here holding a media id when a previous run
  // published it and then lost the status write (the process died between the
  // two). Publishing again would put the same thing on the feed twice.
  if (post.metaPostId) {
    await prisma.scheduledPost.update({
      where: { id: post.id },
      data: { status: 'published', statusMessage: null },
    });
    return { ok: true, status: 'published', metaPostId: post.metaPostId, alreadyPublished: true };
  }

  const creationId = await ensureInstagramContainer(post, credentials, igUserId);

  const state = await pollInstagramContainerReady(
    credentials.pageAccessToken,
    creationId,
    mediaKindFromUrl(post.mediaUrl),
    pollAttempts === undefined ? {} : { attempts: pollAttempts },
  );

  // A previous run already published this container. Publishing it again is
  // how one post becomes two, so this records the fact and stops.
  if (state === 'PUBLISHED') {
    await prisma.scheduledPost.update({
      where: { id: post.id },
      data: { status: 'published', statusMessage: null },
    });
    return { ok: true, status: 'published', metaPostId: post.metaPostId, alreadyPublished: true };
  }

  let mediaId: string;
  try {
    ({ mediaId } = await publishInstagramContainer(credentials.pageAccessToken, igUserId, creationId));
  } catch (error) {
    // media_publish can go through on Meta's side and still fail for us — the
    // Graph call aborts at 20s, and the post is live either way. Believing the
    // error would mark a published post `failed`, and the retry would create a
    // second container and post the whole thing twice. So ask Meta what
    // actually happened before trusting the failure.
    const state = await pollInstagramContainerReady(credentials.pageAccessToken, creationId, 'image', {
      attempts: 1,
    }).catch(() => null);
    if (state !== 'PUBLISHED') throw error;

    await prisma.scheduledPost.update({
      where: { id: post.id },
      data: { status: 'published', statusMessage: null },
    });
    return { ok: true, status: 'published', metaPostId: post.metaPostId, alreadyPublished: true };
  }

  await prisma.scheduledPost.update({
    where: { id: post.id },
    data: { status: 'published', metaPostId: mediaId, statusMessage: null },
  });
  return { ok: true, status: 'published', metaPostId: mediaId, alreadyPublished: false };
}

async function publishFacebookStoryPost(
  post: PostWithInstance,
  config: MetaConfig,
  credentials: MetaCredentials,
): Promise<PublishOutcome> {
  assertMediaUrlIsPublic(post.mediaUrl);

  const { postId } = await publishFacebookStory(credentials.pageAccessToken, config.pageId, post.mediaUrl);

  await prisma.scheduledPost.update({
    where: { id: post.id },
    data: { status: 'published', metaPostId: postId, statusMessage: null },
  });
  return { ok: true, status: 'published', metaPostId: postId, alreadyPublished: false };
}

/**
 * Facebook feed is the one target Meta schedules natively: the post was
 * submitted to Meta when it was created, so there is nothing to publish here
 * — only our own record to reconcile against what Meta actually did.
 */
async function reconcileFacebookFeed(
  post: PostWithInstance,
  credentials: MetaCredentials,
  graceMs: number,
): Promise<PublishOutcome> {
  if (!post.metaPostId) {
    // A Facebook feed row only exists after scheduleFacebookPost succeeded, so
    // a due one with no metaPostId is broken state, not a pending one — there
    // is nothing on Meta's side to reconcile against and waiting will never
    // change that.
    throw new Error('O post nao chegou a ser registrado no Meta. Reagende para tentar de novo.');
  }

  const { isPublished } = await checkFacebookPostStatus(credentials.pageAccessToken, post.metaPostId);
  if (isPublished) {
    await prisma.scheduledPost.update({
      where: { id: post.id },
      data: { status: 'published', statusMessage: null },
    });
    return { ok: true, status: 'published', metaPostId: post.metaPostId, alreadyPublished: true };
  }

  if (Date.now() - post.scheduledFor.getTime() > graceMs) {
    throw new Error('O Meta nao confirmou a publicacao a tempo.');
  }

  // Still within the window Meta has to fire it itself: put the row back so
  // the next run looks again, rather than leaving it held as `publishing`.
  await prisma.scheduledPost.update({ where: { id: post.id }, data: { status: 'scheduled' } });
  return { ok: true, status: 'processing', message: 'O Facebook ainda não confirmou a publicação — aguardando o Meta.' };
}

/** How long a Facebook feed post may sit unconfirmed by Meta before it counts as failed. */
export const FACEBOOK_GRACE_MS = 15 * 60 * 1000;

export interface PublishOptions {
  /**
   * Caps how long the Instagram container poll waits. Left unset (the worker)
   * it uses the full per-media budget; the request path passes a short one so
   * an unfinished video hands back a "still processing" answer instead of
   * holding the HTTP connection open for two minutes.
   */
  inlinePoll?: boolean;
}

/**
 * Publishes one scheduled post, wherever it is in its lifecycle. Safe to call
 * on a row that is due, overdue, previously failed, or stuck mid-publish;
 * safe to call twice. Never throws — every failure is recorded on the row and
 * returned, because both callers need to show it rather than crash on it.
 */
export async function publishScheduledPost(postId: string, options: PublishOptions = {}): Promise<PublishOutcome> {
  const existing = await prisma.scheduledPost.findUnique({
    where: { id: postId },
    include: { connectorInstance: true },
  });
  if (!existing) return { ok: false, status: 'failed', message: 'Post não encontrado.' };
  if (existing.status === 'published') {
    return { ok: true, status: 'published', metaPostId: existing.metaPostId, alreadyPublished: true };
  }

  if (!(await claim(postId))) {
    return { ok: false, status: 'busy', message: 'Este post já está sendo publicado agora mesmo.' };
  }

  // Re-read after the claim so the row carries anything the previous holder
  // recorded (a container id, above all) rather than the pre-claim snapshot.
  const post = (await prisma.scheduledPost.findUnique({
    where: { id: postId },
    include: { connectorInstance: true },
  }))!;

  try {
    const { ctx } = loadConnectorContext(post.connectorInstance);
    const config = ctx.config as MetaConfig;
    const credentials = ctx.credentials as MetaCredentials;

    if (post.platform === 'facebook' && post.postType === 'feed') {
      return await reconcileFacebookFeed(post, credentials, FACEBOOK_GRACE_MS);
    }
    if (post.platform === 'facebook') {
      return await publishFacebookStoryPost(post, config, credentials);
    }
    return await publishInstagram(post, config, credentials, options.inlinePoll ? INLINE_POLL_ATTEMPTS : undefined);
  } catch (error) {
    // Meta is still transcoding: nothing is wrong, the wait was just capped.
    // Back to `scheduled` with the container saved, so the next run — the
    // worker's tick, or the user clicking again — picks up where this stopped.
    if (error instanceof ContainerNotReadyError) {
      await prisma.scheduledPost.update({
        where: { id: post.id },
        data: { status: 'scheduled', statusMessage: null },
      });
      return {
        ok: true,
        status: 'processing',
        message:
          'O Instagram ainda está processando a mídia. O post já está salvo e sai sozinho assim que terminar — não publique de novo.',
      };
    }

    const message = errorMessage(error);
    await markFailed(post, message);
    return { ok: false, status: 'failed', message };
  }
}
