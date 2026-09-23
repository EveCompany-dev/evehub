import { loadConnectorContext, prisma, refreshContentRow } from '@eve/core';
import {
  assertMediaUrlIsPublic,
  checkFacebookPostStatus,
  createInstagramCarouselContainer,
  createInstagramCarouselItemContainer,
  createInstagramContainer,
  createInstagramReelContainer,
  createInstagramStoryContainer,
  fetchPermalink,
  mediaKindFromUrl,
  pollInstagramContainerReady,
  publishFacebookStory,
  publishInstagramContainer,
  type MetaConfig,
  type MetaCredentials,
} from '@eve/connector-meta';

const FACEBOOK_GRACE_MS = 15 * 60 * 1000;

/**
 * Gap enforced between consecutive publish calls TO THE SAME Instagram
 * account within one tick. "Postar agora" (apps/web PostEditor) sets
 * scheduledFor to "now" and lets this same loop pick it up on the next
 * tick — same as any other scheduled post — precisely so a burst of manual
 * posts and a burst of coincidentally-due scheduled ones both land here and
 * get spaced out the same way, rather than an immediate-publish button
 * firing straight at the Graph API in parallel with whatever else is
 * in flight. Firing several posts back-to-back on the *same* account reads
 * to Meta like automation abuse and risks a temporary posting block — a
 * risk that scales with how many accounts a single agency workspace like
 * this one runs, not with any one user's intent. Different accounts publish
 * in the same tick with no extra delay; only re-hitting one account is
 * throttled.
 */
const SAME_ACCOUNT_GAP_MS = 20_000;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const TYPE_LABEL: Record<string, string> = { feed: 'post', story: 'story', reel: 'reel' };

/**
 * The post's Calendário de Conteúdo row follows what just happened to it
 * (Programado → Publicado, or Falhou) — see @eve/core's content-posts. A
 * failure here is logged, never the reason the tick dies: the post's own
 * status is what must be right.
 */
async function syncContentRow(post: { id: string; contentRowId: string | null }): Promise<void> {
  if (!post.contentRowId) return;
  try {
    await refreshContentRow(post.contentRowId);
  } catch (cause) {
    console.error(`[worker] falha ao atualizar o conteudo do post ${post.id}:`, errorMessage(cause));
  }
}

/** Meta confirmed it: record the id and the public link, then move the content row to Publicado. */
async function markPublished(
  post: { id: string; platform: 'instagram' | 'facebook'; postType: string; contentRowId: string | null },
  token: string,
  metaPostId: string,
): Promise<void> {
  let permalink: string | null = null;
  try {
    permalink = await fetchPermalink(token, { platform: post.platform, postType: post.postType, metaPostId });
  } catch (cause) {
    // The post is out either way; only the link in the calendar stays empty.
    console.error(`[worker] falha ao buscar o link do post ${post.id}:`, errorMessage(cause));
  }
  await prisma.scheduledPost.update({ where: { id: post.id }, data: { status: 'published', metaPostId, statusMessage: null, permalink } });
  await syncContentRow(post);
}

/**
 * A post that fails is otherwise completely silent: it happens at a minute
 * nobody is watching, and all it leaves behind is a row that quietly turns
 * red in a calendar cell. Notifying whoever scheduled it is the only thing
 * that actually reaches a person — hence a notification alongside the status
 * write, not just the status write.
 */
async function markFailed(
  post: { id: string; workspaceId: string; createdBy: string; clientLabel: string; platform: string; postType: string; contentRowId: string | null },
  error: unknown,
): Promise<void> {
  const message = errorMessage(error).slice(0, 500);

  await prisma.scheduledPost.update({
    where: { id: post.id },
    data: { status: 'failed', statusMessage: message },
  });
  await syncContentRow(post);

  // Never let the notification be the reason the tick dies: the status write
  // above is the part that must not be lost.
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
    console.error(`[worker] falha ao notificar erro do post ${post.id}:`, errorMessage(cause));
  }
}

/**
 * Instagram (feed and story) has no native scheduling, so this is the actual
 * publish moment for both: create the media container, wait for it to finish
 * processing, then publish it. Facebook feed already submitted to Meta at
 * creation time (native `scheduled_publish_time`) — that branch only
 * reconciles our record with what Meta actually did. Facebook Stories have
 * no native scheduling either (`/photo_stories` publishes immediately on
 * call), so — same as Instagram — this is the real publish moment for those
 * too, not a reconciliation.
 */
export async function processDuePosts(): Promise<{ instagram: number; facebook: number; facebookStory: number }> {
  const now = new Date();

  const dueInstagram = await prisma.scheduledPost.findMany({
    where: { platform: 'instagram', status: 'scheduled', scheduledFor: { lte: now } },
    include: { connectorInstance: true },
  });

  const lastInstagramPublishAt = new Map<string, number>();

  for (const post of dueInstagram) {
    // Same account as whatever we just finished publishing above? Wait out
    // the rest of the gap before touching it again — see SAME_ACCOUNT_GAP_MS.
    const last = lastInstagramPublishAt.get(post.connectorInstanceId);
    if (last !== undefined) {
      const remaining = SAME_ACCOUNT_GAP_MS - (Date.now() - last);
      if (remaining > 0) await sleep(remaining);
    }
    lastInstagramPublishAt.set(post.connectorInstanceId, Date.now());

    await prisma.scheduledPost.update({ where: { id: post.id }, data: { status: 'publishing' } });

    try {
      const { ctx } = loadConnectorContext(post.connectorInstance);
      const config = ctx.config as MetaConfig;
      const credentials = ctx.credentials as MetaCredentials;

      if (!config.instagramBusinessAccountId) {
        throw new Error('Instancia do Meta sem ID da conta do Instagram configurado.');
      }

      // Carrossel: 2-10 imagens em mediaUrls (ver PostEditor's carousel mode).
      // Sempre feed — Stories e Reels nunca tem mediaUrls preenchido.
      const carouselUrls = Array.isArray(post.mediaUrls) ? (post.mediaUrls as unknown[]).filter((url): url is string => typeof url === 'string') : null;

      let creationId: string;
      if (carouselUrls && carouselUrls.length >= 2) {
        carouselUrls.forEach(assertMediaUrlIsPublic);

        // Each slide is its own container that has to finish processing
        // before it can be referenced as a carousel child — same asynchronous
        // contract as a standalone post's container (see
        // pollInstagramContainerReady's doc), just one per slide instead of one.
        const childIds: string[] = [];
        for (const url of carouselUrls) {
          const { creationId: childId } = await createInstagramCarouselItemContainer(
            credentials.pageAccessToken,
            config.instagramBusinessAccountId,
            url,
          );
          await pollInstagramContainerReady(credentials.pageAccessToken, childId, 'image');
          childIds.push(childId);
        }

        creationId = (
          await createInstagramCarouselContainer(credentials.pageAccessToken, config.instagramBusinessAccountId, childIds, post.caption)
        ).creationId;
      } else {
        // Cheaper and far clearer than letting Meta fail the fetch itself.
        assertMediaUrlIsPublic(post.mediaUrl);

        creationId = (
          post.postType === 'story'
            ? await createInstagramStoryContainer(credentials.pageAccessToken, config.instagramBusinessAccountId, post.mediaUrl)
            : post.postType === 'reel'
              ? await createInstagramReelContainer(
                  credentials.pageAccessToken,
                  config.instagramBusinessAccountId,
                  post.mediaUrl,
                  post.caption,
                )
              : await createInstagramContainer(
                  credentials.pageAccessToken,
                  config.instagramBusinessAccountId,
                  post.mediaUrl,
                  post.caption,
                )
        ).creationId;
      }
      await prisma.scheduledPost.update({ where: { id: post.id }, data: { metaCreationId: creationId } });

      // Video containers are transcoded before they can be published, which
      // takes much longer than an image — polling with the wrong budget gives
      // up on a Reel that was going to succeed.
      await pollInstagramContainerReady(credentials.pageAccessToken, creationId, mediaKindFromUrl(post.mediaUrl));
      const { mediaId } = await publishInstagramContainer(
        credentials.pageAccessToken,
        config.instagramBusinessAccountId,
        creationId,
      );

      await markPublished(post, credentials.pageAccessToken, mediaId);
    } catch (error) {
      await markFailed(post, error);
    }
  }

  const dueFacebookFeed = await prisma.scheduledPost.findMany({
    where: { platform: 'facebook', postType: 'feed', status: 'scheduled', scheduledFor: { lte: now } },
    include: { connectorInstance: true },
  });

  for (const post of dueFacebookFeed) {
    // A Facebook feed row only gets created after scheduleFacebookPost
    // succeeds, so a due one with no metaPostId is broken state, not a
    // pending one — there is nothing on Meta's side to reconcile against and
    // waiting another tick will never change that. Fail it loudly instead of
    // skipping, which left the row sitting in `scheduled` forever with no
    // error surfaced to whoever scheduled it.
    if (!post.metaPostId) {
      await markFailed(post, new Error('O post nao chegou a ser registrado no Meta. Reagende para tentar de novo.'));
      continue;
    }

    try {
      const { ctx } = loadConnectorContext(post.connectorInstance);
      const credentials = ctx.credentials as MetaCredentials;

      const { isPublished } = await checkFacebookPostStatus(credentials.pageAccessToken, post.metaPostId);
      if (isPublished) {
        await markPublished(post, credentials.pageAccessToken, post.metaPostId);
      } else if (now.getTime() - post.scheduledFor.getTime() > FACEBOOK_GRACE_MS) {
        await markFailed(post, new Error('O Meta nao confirmou a publicacao a tempo.'));
      }
    } catch (error) {
      console.error(`[worker] falha ao checar status do post ${post.id} no Facebook:`, errorMessage(error));
    }
  }

  const dueFacebookStory = await prisma.scheduledPost.findMany({
    where: { platform: 'facebook', postType: 'story', status: 'scheduled', scheduledFor: { lte: now } },
    include: { connectorInstance: true },
  });

  for (const post of dueFacebookStory) {
    await prisma.scheduledPost.update({ where: { id: post.id }, data: { status: 'publishing' } });

    try {
      const { ctx } = loadConnectorContext(post.connectorInstance);
      const config = ctx.config as MetaConfig;
      const credentials = ctx.credentials as MetaCredentials;

      assertMediaUrlIsPublic(post.mediaUrl);

      const { postId } = await publishFacebookStory(credentials.pageAccessToken, config.pageId, post.mediaUrl);

      await markPublished(post, credentials.pageAccessToken, postId);
    } catch (error) {
      await markFailed(post, error);
    }
  }

  return { instagram: dueInstagram.length, facebook: dueFacebookFeed.length, facebookStory: dueFacebookStory.length };
}
