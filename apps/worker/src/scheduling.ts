import { loadConnectorContext, prisma } from '@eve/core';
import {
  assertMediaUrlIsPublic,
  checkFacebookPostStatus,
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

const FACEBOOK_GRACE_MS = 15 * 60 * 1000;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

const TYPE_LABEL: Record<string, string> = { feed: 'post', story: 'story', reel: 'reel' };

/**
 * A post that fails is otherwise completely silent: it happens at a minute
 * nobody is watching, and all it leaves behind is a row that quietly turns
 * red in a calendar cell. Notifying whoever scheduled it is the only thing
 * that actually reaches a person — hence a notification alongside the status
 * write, not just the status write.
 */
async function markFailed(
  post: { id: string; workspaceId: string; createdBy: string; clientLabel: string; platform: string; postType: string },
  error: unknown,
): Promise<void> {
  const message = errorMessage(error).slice(0, 500);

  await prisma.scheduledPost.update({
    where: { id: post.id },
    data: { status: 'failed', statusMessage: message },
  });

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

  for (const post of dueInstagram) {
    await prisma.scheduledPost.update({ where: { id: post.id }, data: { status: 'publishing' } });

    try {
      const { ctx } = loadConnectorContext(post.connectorInstance);
      const config = ctx.config as MetaConfig;
      const credentials = ctx.credentials as MetaCredentials;

      if (!config.instagramBusinessAccountId) {
        throw new Error('Instancia do Meta sem ID da conta do Instagram configurado.');
      }

      // Cheaper and far clearer than letting Meta fail the fetch itself.
      assertMediaUrlIsPublic(post.mediaUrl);

      const { creationId } =
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
              );
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

      await prisma.scheduledPost.update({
        where: { id: post.id },
        data: { status: 'published', metaPostId: mediaId, statusMessage: null },
      });
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
        await prisma.scheduledPost.update({ where: { id: post.id }, data: { status: 'published' } });
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

      await prisma.scheduledPost.update({
        where: { id: post.id },
        data: { status: 'published', metaPostId: postId, statusMessage: null },
      });
    } catch (error) {
      await markFailed(post, error);
    }
  }

  return { instagram: dueInstagram.length, facebook: dueFacebookFeed.length, facebookStory: dueFacebookStory.length };
}
