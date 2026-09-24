import { loadConnectorContext, prisma, Prisma, refreshContentRow } from '@eve/core';
import {
  assertMediaUrlIsPublic,
  deleteFacebookPost,
  isMissingObjectError,
  MAX_CAROUSEL_ITEMS,
  mediaKindFromUrl,
  MIN_CAROUSEL_ITEMS,
  scheduleFacebookPost,
  targetAcceptsMedia,
  targetLabel,
  type MetaConfig,
  type MetaCredentials,
  type PostTypeName,
} from '@eve/connector-meta';
import { strings } from '@eve/ui';
import { z } from 'zod';
import { logActivity, postLabel, whenLabel } from '../../../../../lib/activity';
import { fail, handle, ok } from '../../../../../lib/api';
import { canViewScheduling } from '../../../../../lib/permissions';
import { HttpError, requireUser } from '../../../../../lib/session';
import { requireManagedPost } from '../../post-access';

export const runtime = 'nodejs';

const patchSchema = z.object({
  caption: z.string().max(2200).optional(),
  mediaUrl: z.string().url().optional(),
  /** A carousel's full, ordered list of images; only for posts that already are one. */
  mediaUrls: z.array(z.string().url()).min(MIN_CAROUSEL_ITEMS).max(MAX_CAROUSEL_ITEMS).optional(),
  scheduledFor: z.string().datetime().optional(),
  client: z.object({ id: z.string().min(1), label: z.string().min(1) }).optional(),
});

/** The post's Calendário de Conteúdo row catches up (date, Status) — never the reason a request fails. */
async function syncContentRow(rowId: string | null): Promise<void> {
  if (!rowId) return;
  try {
    await refreshContentRow(rowId);
  } catch (error) {
    console.error('[scheduling] falha ao atualizar o Calendário de Conteúdo:', error);
  }
}

/** One post, for Agendar Post's edit view (/scheduling?post=<id>) — the row only, never its connector's credentials. */
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const user = await requireUser();
    if (!canViewScheduling(user)) throw new HttpError(403, strings.errors.notAllowedScheduling);

    const { id } = await context.params;
    const post = await prisma.scheduledPost.findUnique({ where: { id } });
    if (!post || post.workspaceId !== user.workspaceId) throw new HttpError(404, strings.errors.notFound);
    return ok({ post });
  });
}

const MIN_LEAD_MS = 10 * 60 * 1000; // Meta rejects a Facebook schedule under ~10 minutes out.
const MAX_LEAD_MS = 75 * 24 * 60 * 60 * 1000; // ...and past 75 days.

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * The media a post will have after this edit, checked the same way POST
 * checks it: public URLs only, the right kind for the destination, and a
 * carousel changes as a whole (its first image is `mediaUrl`), so what is
 * stored is always exactly what gets published.
 */
function resolveMedia(
  post: { platform: 'instagram' | 'facebook'; postType: string; mediaUrl: string; mediaUrls: unknown },
  body: { mediaUrl?: string; mediaUrls?: string[] },
): { mediaUrl: string; mediaUrls: string[] | null } | { error: string } {
  const current = Array.isArray(post.mediaUrls) ? (post.mediaUrls as unknown[]).filter((url): url is string => typeof url === 'string') : null;
  const isCarousel = current !== null && current.length >= MIN_CAROUSEL_ITEMS;

  if (isCarousel) {
    if (body.mediaUrls) {
      if (body.mediaUrls.some((url) => mediaKindFromUrl(url) === 'video')) return { error: 'Carrossel aceita apenas imagens — remova o vídeo.' };
      try {
        body.mediaUrls.forEach(assertMediaUrlIsPublic);
      } catch (error) {
        return { error: messageOf(error) };
      }
      return { mediaUrl: body.mediaUrls[0]!, mediaUrls: body.mediaUrls };
    }
    if (body.mediaUrl && body.mediaUrl !== post.mediaUrl) return { error: 'Para trocar a mídia de um carrossel, envie todas as imagens dele.' };
    return { mediaUrl: post.mediaUrl, mediaUrls: current };
  }

  if (body.mediaUrls) return { error: 'Só um carrossel do Instagram tem várias mídias.' };
  const mediaUrl = body.mediaUrl ?? post.mediaUrl;
  if (mediaUrl !== post.mediaUrl) {
    try {
      assertMediaUrlIsPublic(mediaUrl);
    } catch (error) {
      return { error: messageOf(error) };
    }
    const kind = mediaKindFromUrl(mediaUrl);
    const target = { platform: post.platform, postType: post.postType as PostTypeName };
    if (!targetAcceptsMedia(target, kind)) {
      return { error: `${targetLabel(target)}: ${kind === 'video' ? 'não aceita vídeo' : 'precisa de um vídeo'}.` };
    }
  }
  return { mediaUrl, mediaUrls: null };
}

/**
 * Edits a post that hasn't gone out, or a failed one (which then goes back
 * to `scheduled`: a retry keeps the same row, so the calendar and history
 * stay one line). Everything is validated before Meta is touched: a
 * Facebook feed post is already scheduled on Meta, and an edit there is
 * delete-and-resubmit, so a rejected edit must never have deleted it first.
 */
export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const user = await requireUser();
    const { id } = await context.params;
    const post = await requireManagedPost(id, user);

    if (post.status === 'publishing') return fail(409, strings.scheduling.stillPublishing);
    if (post.status === 'published') return fail(409, strings.scheduling.alreadyPublished);

    const body = patchSchema.safeParse(await request.json());
    if (!body.success) return fail(400, strings.errors.invalidPayload);

    if (body.data.client && !(await prisma.client.findFirst({ where: { id: body.data.client.id, workspaceId: user.workspaceId }, select: { id: true } }))) {
      return fail(400, strings.scheduling.unknownClient);
    }

    const media = resolveMedia(post, body.data);
    if ('error' in media) return fail(400, media.error);

    const caption = body.data.caption ?? post.caption;
    const scheduledFor = body.data.scheduledFor ? new Date(body.data.scheduledFor) : post.scheduledFor;
    const clientFields = body.data.client
      ? { clientSource: 'local' as const, clientId: body.data.client.id, clientRemoteId: null, clientLabel: body.data.client.label }
      : {};
    const contentChanged =
      caption !== post.caption || media.mediaUrl !== post.mediaUrl || JSON.stringify(media.mediaUrls) !== JSON.stringify(post.mediaUrls ?? null);
    const timeChanged = scheduledFor.getTime() !== post.scheduledFor.getTime();

    let metaPostId = post.metaPostId;
    const isFacebookFeed = post.platform === 'facebook' && post.postType === 'feed';

    if (isFacebookFeed && (contentChanged || timeChanged || post.status === 'failed' || !post.metaPostId)) {
      const leadMs = scheduledFor.getTime() - Date.now();
      if (leadMs < MIN_LEAD_MS || leadMs > MAX_LEAD_MS) return fail(400, 'O Facebook só agenda posts entre 10 minutos e 75 dias no futuro.');

      let config: MetaConfig;
      let credentials: MetaCredentials;
      try {
        const loaded = loadConnectorContext(post.connectorInstance);
        config = loaded.ctx.config as MetaConfig;
        credentials = loaded.ctx.credentials as MetaCredentials;
      } catch (error) {
        return fail(400, messageOf(error));
      }

      // Split from the resubmit below on purpose: if the delete itself fails
      // nothing has been destroyed yet, so the row can stay exactly as it was.
      // Already gone on Meta's side is fine: there is nothing to cancel.
      if (post.metaPostId) {
        try {
          await deleteFacebookPost(credentials.pageAccessToken, post.metaPostId);
        } catch (error) {
          if (!isMissingObjectError(error)) return fail(502, messageOf(error));
        }
      }

      try {
        const rescheduled = await scheduleFacebookPost(credentials.pageAccessToken, config.pageId, media.mediaUrl, caption, Math.floor(scheduledFor.getTime() / 1000));
        metaPostId = rescheduled.postId;
      } catch (error) {
        // Past this point the old post is already gone from Meta. Mark it
        // failed so it shows up as such instead of `scheduled` against a
        // deleted post id.
        const message = messageOf(error);
        await prisma.scheduledPost.updateMany({
          where: { id },
          data: {
            status: 'failed',
            metaPostId: null,
            statusMessage: `O post anterior foi cancelado, mas o reagendamento falhou: ${message}`.slice(0, 500),
          },
        });
        await syncContentRow(post.contentRowId);
        return fail(502, message);
      }
    }

    // Conditional on the status read above: if the worker claimed the post in
    // the meantime, this edit loses instead of racing the publish.
    const result = await prisma.scheduledPost.updateMany({
      where: { id, status: post.status },
      data: {
        caption,
        mediaUrl: media.mediaUrl,
        mediaUrls: media.mediaUrls ?? Prisma.DbNull,
        scheduledFor,
        metaPostId,
        ...clientFields,
        // An Instagram container embeds the caption and media it was made
        // from: after an edit it would publish the old version.
        ...(contentChanged ? { metaCreationId: null } : {}),
        ...(post.status === 'failed' || contentChanged ? { status: post.status === 'draft' ? 'draft' : 'scheduled', statusMessage: null } : {}),
      },
    });
    if (result.count !== 1) return fail(409, strings.scheduling.stillPublishing);

    const updated = (await prisma.scheduledPost.findUnique({ where: { id } }))!;
    await syncContentRow(updated.contentRowId);

    await logActivity(user, {
      action: 'post.update',
      summary: timeChanged
        ? `remarcou o post (${postLabel(updated)}) para ${whenLabel(updated.scheduledFor)}`
        : `editou o post agendado (${postLabel(updated)})`,
      entityType: 'scheduledPost',
      entityId: id,
    });

    return ok({ post: updated });
  });
}

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const user = await requireUser();
    const { id } = await context.params;
    const post = await requireManagedPost(id, user);

    // Mid-publish, deleting the row would not stop the post: it goes out anyway, with no record.
    if (post.status === 'publishing') return fail(409, strings.scheduling.stillPublishing);

    if (post.platform === 'facebook' && post.postType === 'feed' && post.metaPostId && (post.status === 'scheduled' || post.status === 'failed')) {
      try {
        const loaded = loadConnectorContext(post.connectorInstance);
        const credentials = loaded.ctx.credentials as MetaCredentials;
        await deleteFacebookPost(credentials.pageAccessToken, post.metaPostId);
      } catch (error) {
        // The Meta-side cancel failing must not block removing our own row —
        // worst case the post still goes live and this record is just gone.
        console.error('[scheduling] falha ao cancelar post no Meta:', error);
      }
    }

    // Conditional too: the worker may have claimed it since the read above.
    const removed = await prisma.scheduledPost.deleteMany({ where: { id, status: { not: 'publishing' } } });
    if (removed.count !== 1) return fail(409, strings.scheduling.stillPublishing);

    await syncContentRow(post.contentRowId);
    await logActivity(user, {
      action: 'post.delete',
      summary: `cancelou o post agendado (${postLabel(post)}) de ${whenLabel(post.scheduledFor)}`,
      entityType: 'scheduledPost',
      entityId: id,
    });
    return ok({ ok: true });
  });
}
