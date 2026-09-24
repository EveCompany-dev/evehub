import { loadConnectorContext } from './connector-context';
import { refreshContentRow } from './content-posts';
import { prisma, type Prisma } from './prisma';

/**
 * Publishing one scheduled post, exactly once. The worker's tick and the
 * "Postar agora" / "Tentar de novo" route both go through `publishPost`, so
 * there is one place that decides whether a row may be published and one
 * sequence of Meta calls.
 *
 * Exactly once rests on three things:
 *
 * 1. **A conditional claim.** A row moves to `publishing` with an
 *    `updateMany` whose `where` only matches a claimable row, and only the
 *    caller whose update counted 1 goes on. Two ticks, or a tick and a
 *    click, can race for a row; one of them wins, the other skips it. A row
 *    left in `publishing` by a crash is claimable again once it has not been
 *    touched for STALE_PUBLISHING_MS — every step below touches it, so a
 *    slow publish in progress never looks stale.
 * 2. **Re-entrant steps.** The Instagram container id is saved the moment it
 *    exists, and a later attempt asks Meta about that container before doing
 *    anything: PUBLISHED is recorded as published, FINISHED is published,
 *    still processing is waited on. A row that already has `metaPostId` is
 *    never sent to Meta again.
 * 3. **An unknown outcome is not a failure.** When `media_publish` fails or
 *    times out, the container is asked again: Meta may have published it
 *    anyway. A Facebook story has no container to ask, so a timeout there
 *    fails with a message saying it may have gone out, and a crashed attempt
 *    is never re-sent on its own.
 *
 * The Meta calls come in as `MetaPublishApi` (implemented by
 * @eve/connector-meta's `metaPublishApi`): @eve/core does not depend on the
 * Meta connector, and the tests swap in fakes.
 */

/** A `publishing` row nobody has touched for this long belongs to a runner that died. */
export const STALE_PUBLISHING_MS = 5 * 60 * 1000;

/**
 * An Instagram container still processing this long after the post was due
 * is not going to finish: give up instead of resuming it forever.
 */
const PROCESSING_GIVE_UP_MS = 60 * 60 * 1000;

type MediaKind = 'image' | 'video';

/** The Meta Graph calls publishing needs. Signatures match @eve/connector-meta. */
export interface MetaPublishApi {
  assertMediaUrlIsPublic(mediaUrl: string): void;
  mediaKindFromUrl(mediaUrl: string): MediaKind;
  createInstagramContainer(token: string, igUserId: string, imageUrl: string, caption: string): Promise<{ creationId: string }>;
  createInstagramStoryContainer(token: string, igUserId: string, mediaUrl: string): Promise<{ creationId: string }>;
  createInstagramReelContainer(token: string, igUserId: string, videoUrl: string, caption: string): Promise<{ creationId: string }>;
  createInstagramCarouselItemContainer(token: string, igUserId: string, imageUrl: string): Promise<{ creationId: string }>;
  createInstagramCarouselContainer(token: string, igUserId: string, childIds: string[], caption: string): Promise<{ creationId: string }>;
  getInstagramContainerStatus(token: string, creationId: string): Promise<string | null>;
  /** Resolves 'FINISHED' or 'PUBLISHED'; throws when the container failed or is still processing (see isStillProcessing). */
  pollInstagramContainerReady(token: string, creationId: string, kind?: MediaKind): Promise<'FINISHED' | 'PUBLISHED'>;
  publishInstagramContainer(token: string, igUserId: string, creationId: string): Promise<{ mediaId: string }>;
  publishFacebookStory(token: string, pageId: string, imageUrl: string): Promise<{ postId: string }>;
  fetchPermalink(token: string, post: { platform: 'instagram' | 'facebook'; postType: string; metaPostId: string }): Promise<string | null>;
  /** The poll ran out of time but the container is still processing on Meta's side. */
  isStillProcessing(error: unknown): boolean;
  /** We never heard Meta's answer (timeout, dropped connection, 5xx): the call may have taken effect. */
  isUnknownOutcomeError(error: unknown): boolean;
}

export type PublishOutcome =
  | { kind: 'published'; postId: string }
  /** Instagram is still processing the media; the row is `scheduled` again and the worker resumes it. */
  | { kind: 'processing'; postId: string }
  | { kind: 'failed'; postId: string; message: string }
  /** Someone else holds the row, it is not due, or it is in a state this call may not publish from. */
  | { kind: 'skipped'; postId: string; reason: 'not-found' | 'not-claimable' };

export interface PublishOptions {
  /**
   * The worker only publishes rows that are due: a post rescheduled to later
   * since the tick read it is left alone. "Postar agora" publishes regardless
   * and moves `scheduledFor` to now, so the calendar shows when it went out.
   */
  mode: 'due' | 'now';
  /** A `failed` row may be claimed only on a person's explicit retry, never by the tick. */
  allowFailed?: boolean;
  /** Test seam. */
  now?: () => Date;
}

type ClaimedPost = Prisma.ScheduledPostGetPayload<{ include: { connectorInstance: true } }>;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Facebook feed posts are scheduled on Meta's side at creation time; this
 * function never publishes them (the worker only reconciles them).
 */
export function isWorkerPublished(post: { platform: string; postType: string }): boolean {
  return !(post.platform === 'facebook' && post.postType === 'feed');
}

/**
 * Tries to move one row to `publishing`. Returns whether this caller got it
 * and whether it was a stale `publishing` row (a crashed earlier attempt).
 */
async function claim(postId: string, options: PublishOptions, now: Date): Promise<{ claimed: boolean; wasStale: boolean }> {
  const due = options.mode === 'due' ? { scheduledFor: { lte: now } } : {};
  const data = { status: 'publishing' as const, statusMessage: null, ...(options.mode === 'now' ? { scheduledFor: now } : {}) };
  const fresh = await prisma.scheduledPost.updateMany({
    where: { id: postId, ...due, status: { in: options.allowFailed ? ['scheduled', 'failed'] : ['scheduled'] } },
    data,
  });
  if (fresh.count === 1) return { claimed: true, wasStale: false };

  const stale = await prisma.scheduledPost.updateMany({
    where: { id: postId, ...due, status: 'publishing', updatedAt: { lt: new Date(now.getTime() - STALE_PUBLISHING_MS) } },
    data,
  });
  return { claimed: stale.count === 1, wasStale: stale.count === 1 };
}

/** Keeps a long publish from looking stale to another runner. */
async function touch(postId: string, data: Prisma.ScheduledPostUpdateManyMutationInput = {}): Promise<void> {
  await prisma.scheduledPost.updateMany({ where: { id: postId, status: 'publishing' }, data: { ...data, updatedAt: new Date() } });
}

/**
 * The post's Calendário de Conteúdo row follows what just happened to it
 * (Programado → Publicado, or Falhou). A failure here is logged, never the
 * reason a publish is reported as failed: the post's own status is what must
 * be right.
 */
async function syncContentRow(post: { id: string; contentRowId: string | null }): Promise<void> {
  if (!post.contentRowId) return;
  try {
    await refreshContentRow(post.contentRowId);
  } catch (cause) {
    console.error(`[scheduling] falha ao atualizar o conteudo do post ${post.id}:`, errorMessage(cause));
  }
}

const TYPE_LABEL: Record<string, string> = { feed: 'post', story: 'story', reel: 'reel' };

export interface MarkablePost {
  id: string;
  workspaceId: string;
  createdBy: string;
  clientLabel: string;
  platform: 'instagram' | 'facebook';
  postType: string;
  contentRowId: string | null;
}

/**
 * Meta confirmed it: record the id and the public link, then move the content
 * row to Publicado. `metaPostId` is null when Meta confirmed the container
 * went out but gave us no media id (a publish whose answer we lost).
 * A no-op on a row that has since been deleted.
 */
export async function markPublished(post: MarkablePost, token: string, metaPostId: string | null, api: Pick<MetaPublishApi, 'fetchPermalink'>): Promise<void> {
  let permalink: string | null = null;
  if (metaPostId) {
    try {
      permalink = await api.fetchPermalink(token, { platform: post.platform, postType: post.postType, metaPostId });
    } catch (cause) {
      // The post is out either way; only the link in the calendar stays empty.
      console.error(`[scheduling] falha ao buscar o link do post ${post.id}:`, errorMessage(cause));
    }
  }
  const result = await prisma.scheduledPost.updateMany({
    where: { id: post.id, status: { in: ['scheduled', 'publishing'] } },
    data: {
      status: 'published',
      statusMessage: metaPostId ? null : 'Publicado — o Instagram confirmou, mas não devolveu o link.',
      permalink,
      ...(metaPostId ? { metaPostId } : {}),
    },
  });
  if (result.count === 1) await syncContentRow(post);
}

/**
 * A post that fails is otherwise completely silent: it happens at a minute
 * nobody is watching. Notifying whoever scheduled it is what reaches a
 * person. A no-op on a row that has since been deleted (and then nobody is
 * notified about a post that no longer exists).
 */
export async function markFailed(post: MarkablePost, error: unknown): Promise<string> {
  const message = errorMessage(error).slice(0, 500);

  const result = await prisma.scheduledPost.updateMany({
    where: { id: post.id, status: { in: ['scheduled', 'publishing'] } },
    data: { status: 'failed', statusMessage: message },
  });
  if (result.count !== 1) return message;
  await syncContentRow(post);

  try {
    const what = `${post.platform === 'instagram' ? 'Instagram' : 'Facebook'} ${TYPE_LABEL[post.postType] ?? post.postType}`;
    await prisma.notification.create({
      data: {
        workspaceId: post.workspaceId,
        userId: post.createdBy,
        type: 'scheduledPostFailed',
        message: `O ${what} de ${post.clientLabel} não foi publicado: ${message}`,
      },
    });
  } catch (cause) {
    console.error(`[scheduling] falha ao notificar erro do post ${post.id}:`, errorMessage(cause));
  }
  return message;
}

/** Media still processing on Meta's side: hand the row back to the tick, keeping its container. */
async function releaseForLater(post: ClaimedPost): Promise<void> {
  await prisma.scheduledPost.updateMany({
    where: { id: post.id, status: 'publishing' },
    data: { status: 'scheduled', statusMessage: 'O Instagram ainda está processando a mídia; o agendador tenta de novo em instantes.' },
  });
}

function carouselUrlsOf(post: ClaimedPost): string[] | null {
  if (!Array.isArray(post.mediaUrls)) return null;
  const urls = (post.mediaUrls as unknown[]).filter((url): url is string => typeof url === 'string');
  return urls.length >= 2 ? urls : null;
}

interface MetaAccess {
  token: string;
  pageId: string;
  igUserId: string | undefined;
}

function metaAccess(post: ClaimedPost): MetaAccess {
  const { ctx } = loadConnectorContext(post.connectorInstance);
  const config = ctx.config as { pageId?: string; instagramBusinessAccountId?: string };
  const credentials = ctx.credentials as { pageAccessToken?: string };
  if (!credentials.pageAccessToken) throw new Error('A conexão do Meta deste post está sem token. Reconecte a conta.');
  return { token: credentials.pageAccessToken, pageId: config.pageId ?? '', igUserId: config.instagramBusinessAccountId };
}

/** Creates the container(s) for a post and returns the id to publish. Saves it before returning. */
async function createContainer(post: ClaimedPost, access: MetaAccess & { igUserId: string }, api: MetaPublishApi): Promise<string> {
  const carousel = carouselUrlsOf(post);
  let creationId: string;
  if (carousel) {
    carousel.forEach((url) => api.assertMediaUrlIsPublic(url));
    // Each slide is its own container that has to finish processing before
    // it can be a carousel child. Slides are never published on their own,
    // so recreating them on a retry is harmless.
    const childIds: string[] = [];
    for (const url of carousel) {
      const { creationId: childId } = await api.createInstagramCarouselItemContainer(access.token, access.igUserId, url);
      await api.pollInstagramContainerReady(access.token, childId, 'image');
      childIds.push(childId);
      await touch(post.id);
    }
    creationId = (await api.createInstagramCarouselContainer(access.token, access.igUserId, childIds, post.caption)).creationId;
  } else {
    api.assertMediaUrlIsPublic(post.mediaUrl);
    creationId = (
      post.postType === 'story'
        ? await api.createInstagramStoryContainer(access.token, access.igUserId, post.mediaUrl)
        : post.postType === 'reel'
          ? await api.createInstagramReelContainer(access.token, access.igUserId, post.mediaUrl, post.caption)
          : await api.createInstagramContainer(access.token, access.igUserId, post.mediaUrl, post.caption)
    ).creationId;
  }
  // Saved before anything else can go wrong: this id is what makes a retry safe.
  await touch(post.id, { metaCreationId: creationId });
  return creationId;
}

async function publishInstagram(post: ClaimedPost, access: MetaAccess, api: MetaPublishApi, now: Date): Promise<PublishOutcome> {
  if (!access.igUserId) throw new Error('Instancia do Meta sem ID da conta do Instagram configurado.');
  const ig = { ...access, igUserId: access.igUserId };

  // 1. A container from an earlier attempt: ask Meta where it stands first.
  let creationId: string | null = post.metaCreationId;
  if (creationId) {
    let status: string | null;
    try {
      status = await api.getInstagramContainerStatus(ig.token, creationId);
    } catch (error) {
      if (api.isUnknownOutcomeError(error)) throw error;
      status = null; // Meta no longer knows it: start over.
    }
    if (status === 'PUBLISHED') {
      await markPublished(post, ig.token, null, api);
      return { kind: 'published', postId: post.id };
    }
    if (status !== 'FINISHED' && status !== 'IN_PROGRESS') creationId = null; // EXPIRED, ERROR or gone.
  }

  // 2. No usable container: make one (and remember it).
  if (!creationId) creationId = await createContainer(post, ig, api);

  // 3. Wait for it. Running out of time is not a failure: Meta keeps processing.
  let ready: 'FINISHED' | 'PUBLISHED';
  try {
    ready = await api.pollInstagramContainerReady(ig.token, creationId, carouselUrlsOf(post) ? 'image' : api.mediaKindFromUrl(post.mediaUrl));
  } catch (error) {
    if (api.isStillProcessing(error) && now.getTime() - post.scheduledFor.getTime() < PROCESSING_GIVE_UP_MS) {
      await releaseForLater(post);
      return { kind: 'processing', postId: post.id };
    }
    throw error;
  }
  if (ready === 'PUBLISHED') {
    await markPublished(post, ig.token, null, api);
    return { kind: 'published', postId: post.id };
  }

  // 4. Publish. If that fails in any way, Meta may still have done it: ask the container.
  await touch(post.id);
  try {
    const { mediaId } = await api.publishInstagramContainer(ig.token, ig.igUserId, creationId);
    await markPublished(post, ig.token, mediaId, api);
    return { kind: 'published', postId: post.id };
  } catch (error) {
    let after: string | null = null;
    try {
      after = await api.getInstagramContainerStatus(ig.token, creationId);
    } catch {
      after = null;
    }
    if (after === 'PUBLISHED') {
      await markPublished(post, ig.token, null, api);
      return { kind: 'published', postId: post.id };
    }
    // Still unknown: say so. A retry is safe — it asks this same container first.
    if (after === null && api.isUnknownOutcomeError(error)) {
      throw new Error('O Instagram não confirmou a publicação — ela pode ter saído. "Tentar de novo" confere antes de publicar outra vez.');
    }
    throw error;
  }
}

const STORY_MAY_HAVE_POSTED =
  'O Facebook não confirmou a publicação do story — ele pode ter saído. Confira a Página antes de tentar de novo.';

async function publishFacebookStoryPost(post: ClaimedPost, access: MetaAccess, api: MetaPublishApi, wasStale: boolean): Promise<PublishOutcome> {
  // A crashed earlier attempt may have posted it, and there is no container
  // to ask: a person decides, never an automatic second post.
  if (wasStale) {
    return { kind: 'failed', postId: post.id, message: await markFailed(post, new Error(STORY_MAY_HAVE_POSTED)) };
  }
  api.assertMediaUrlIsPublic(post.mediaUrl);
  try {
    const { postId } = await api.publishFacebookStory(access.token, access.pageId, post.mediaUrl);
    await markPublished(post, access.token, postId, api);
    return { kind: 'published', postId: post.id };
  } catch (error) {
    if (api.isUnknownOutcomeError(error)) {
      return { kind: 'failed', postId: post.id, message: await markFailed(post, new Error(STORY_MAY_HAVE_POSTED)) };
    }
    throw error;
  }
}

/**
 * Publishes one post if this caller can claim it. Never throws for anything
 * about the post itself: every failure becomes a `failed` row (and a
 * notification) and a `failed` outcome, so a loop over many posts keeps going.
 */
export async function publishPost(postId: string, api: MetaPublishApi, options: PublishOptions): Promise<PublishOutcome> {
  const now = options.now?.() ?? new Date();

  const existing = await prisma.scheduledPost.findUnique({ where: { id: postId }, select: { platform: true, postType: true } });
  if (!existing) return { kind: 'skipped', postId, reason: 'not-found' };
  if (!isWorkerPublished(existing)) return { kind: 'skipped', postId, reason: 'not-claimable' };

  const { claimed, wasStale } = await claim(postId, options, now);
  if (!claimed) return { kind: 'skipped', postId, reason: 'not-claimable' };

  // Read AFTER the claim: whatever was edited up to this moment is what goes out.
  const post = await prisma.scheduledPost.findUnique({ where: { id: postId }, include: { connectorInstance: true } });
  if (!post) return { kind: 'skipped', postId, reason: 'not-found' };

  try {
    if (post.metaPostId) {
      // Already on Meta: only our record was behind. Never publish it again.
      let token = '';
      try {
        token = metaAccess(post).token;
      } catch {
        // No usable token: the post is still published, only its link stays empty.
      }
      await markPublished(post, token, post.metaPostId, token ? api : { fetchPermalink: async () => null });
      return { kind: 'published', postId };
    }

    if (post.connectorInstance.status === 'disabled') {
      throw new Error('A conexão do Meta deste post está desativada. Reative-a em Equipe > Conectores e tente de novo.');
    }

    const access = metaAccess(post);
    return post.platform === 'instagram' ? await publishInstagram(post, access, api, now) : await publishFacebookStoryPost(post, access, api, wasStale);
  } catch (error) {
    return { kind: 'failed', postId, message: await markFailed(post, error) };
  }
}
