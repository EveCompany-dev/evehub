import { loadConnectorContext, prisma } from '@eve/core';
import {
  checkFacebookPostStatus,
  createInstagramContainer,
  pollInstagramContainerReady,
  publishInstagramContainer,
  type MetaConfig,
  type MetaCredentials,
} from '@eve/connector-meta';

const FACEBOOK_GRACE_MS = 15 * 60 * 1000;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Instagram has no native scheduling, so this is the actual publish moment:
 * create the media container, wait for it to finish processing, then
 * publish it. Facebook already submitted to Meta at creation time (native
 * `scheduled_publish_time`) — this only reconciles our record with what
 * Meta actually did.
 */
export async function processDuePosts(): Promise<{ instagram: number; facebook: number }> {
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

      const { creationId } = await createInstagramContainer(
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

  const dueFacebook = await prisma.scheduledPost.findMany({
    where: { platform: 'facebook', status: 'scheduled', scheduledFor: { lte: now } },
    include: { connectorInstance: true },
  });

  for (const post of dueFacebook) {
    if (!post.metaPostId) continue;

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

  return { instagram: dueInstagram.length, facebook: dueFacebook.length };
}
