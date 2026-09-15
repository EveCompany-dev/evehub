import { loadConnectorContext, prisma } from '@eve/core';
import {
  checkFacebookPostStatus,
  createInstagramContainer,
  createInstagramStoryContainer,
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

      const { creationId } =
        post.postType === 'story'
          ? await createInstagramStoryContainer(credentials.pageAccessToken, config.instagramBusinessAccountId, post.mediaUrl)
          : await createInstagramContainer(
              credentials.pageAccessToken,
              config.instagramBusinessAccountId,
              post.mediaUrl,
              post.caption,
            );
      await prisma.scheduledPost.update({ where: { id: post.id }, data: { metaCreationId: creationId } });

      await pollInstagramContainerReady(credentials.pageAccessToken, creationId);
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
      await prisma.scheduledPost.update({
        where: { id: post.id },
        data: { status: 'failed', statusMessage: errorMessage(error).slice(0, 500) },
      });
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
      await prisma.scheduledPost.update({
        where: { id: post.id },
        data: {
          status: 'failed',
          statusMessage: 'O post nao chegou a ser registrado no Meta. Reagende para tentar de novo.',
        },
      });
      continue;
    }

    try {
      const { ctx } = loadConnectorContext(post.connectorInstance);
      const credentials = ctx.credentials as MetaCredentials;

      const { isPublished } = await checkFacebookPostStatus(credentials.pageAccessToken, post.metaPostId);
      if (isPublished) {
        await prisma.scheduledPost.update({ where: { id: post.id }, data: { status: 'published' } });
      } else if (now.getTime() - post.scheduledFor.getTime() > FACEBOOK_GRACE_MS) {
        await prisma.scheduledPost.update({
          where: { id: post.id },
          data: { status: 'failed', statusMessage: 'O Meta nao confirmou a publicacao a tempo.' },
        });
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

      const { postId } = await publishFacebookStory(credentials.pageAccessToken, config.pageId, post.mediaUrl);

      await prisma.scheduledPost.update({
        where: { id: post.id },
        data: { status: 'published', metaPostId: postId, statusMessage: null },
      });
    } catch (error) {
      await prisma.scheduledPost.update({
        where: { id: post.id },
        data: { status: 'failed', statusMessage: errorMessage(error).slice(0, 500) },
      });
    }
  }

  return { instagram: dueInstagram.length, facebook: dueFacebookFeed.length, facebookStory: dueFacebookStory.length };
}
