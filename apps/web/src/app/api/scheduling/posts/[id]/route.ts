import { loadConnectorContext, prisma, refreshContentRow } from '@eve/core';
import { deleteFacebookPost, scheduleFacebookPost, type MetaConfig, type MetaCredentials } from '@eve/connector-meta';
import { strings } from '@eve/ui';
import { z } from 'zod';
import { logActivity, postLabel, whenLabel } from '../../../../../lib/activity';
import { fail, handle, ok } from '../../../../../lib/api';
import { canViewScheduling } from '../../../../../lib/permissions';
import { HttpError, requireUser } from '../../../../../lib/session';

export const runtime = 'nodejs';

const patchSchema = z.object({
  caption: z.string().max(2200).optional(),
  mediaUrl: z.string().url().optional(),
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

async function requirePost(id: string, workspaceId: string) {
  const post = await prisma.scheduledPost.findUnique({ where: { id }, include: { connectorInstance: true } });
  if (!post || post.workspaceId !== workspaceId) throw new HttpError(404, strings.errors.notFound);
  return post;
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

/**
 * Only while a post hasn't gone live. Facebook has already submitted to Meta
 * by this point (native scheduling), so an edit there means delete-and-
 * resubmit under the hood, not an in-place patch — Meta doesn't support
 * changing every field of an already-scheduled post at will.
 */
export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const user = await requireUser();
    if (!canViewScheduling(user)) throw new HttpError(403, strings.errors.notAllowedScheduling);

    const { id } = await context.params;
    const post = await requirePost(id, user.workspaceId);

    if (post.status !== 'draft' && post.status !== 'scheduled') {
      return fail(409, 'Só dá para editar enquanto o post ainda não foi publicado.');
    }

    const body = patchSchema.safeParse(await request.json());
    if (!body.success) return fail(400, strings.errors.invalidPayload);

    const caption = body.data.caption ?? post.caption;
    const mediaUrl = body.data.mediaUrl ?? post.mediaUrl;
    const scheduledFor = body.data.scheduledFor ? new Date(body.data.scheduledFor) : post.scheduledFor;
    const clientFields = body.data.client
      ? { clientSource: 'local' as const, clientId: body.data.client.id, clientRemoteId: null, clientLabel: body.data.client.label }
      : {};

    let metaPostId = post.metaPostId;

    if (post.platform === 'facebook' && post.metaPostId) {
      let config: MetaConfig;
      let credentials: MetaCredentials;
      try {
        const loaded = loadConnectorContext(post.connectorInstance);
        config = loaded.ctx.config as MetaConfig;
        credentials = loaded.ctx.credentials as MetaCredentials;
      } catch (error) {
        return fail(400, error instanceof Error ? error.message : String(error));
      }

      // Split from the resubmit below on purpose: if the delete itself fails
      // nothing has been destroyed yet, so the row can stay exactly as it was.
      try {
        await deleteFacebookPost(credentials.pageAccessToken, post.metaPostId);
      } catch (error) {
        return fail(502, error instanceof Error ? error.message : String(error));
      }

      try {
        const rescheduled = await scheduleFacebookPost(
          credentials.pageAccessToken,
          config.pageId,
          mediaUrl,
          caption,
          Math.floor(scheduledFor.getTime() / 1000),
        );
        metaPostId = rescheduled.postId;
      } catch (error) {
        // Past this point the old post is already gone from Meta. Bailing out
        // with the row untouched would leave it `scheduled` against a deleted
        // post id — the worker would retry that forever and the post would
        // silently never go live. Mark it failed so it shows up as such.
        const message = error instanceof Error ? error.message : String(error);
        await prisma.scheduledPost.update({
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

    const updated = await prisma.scheduledPost.update({
      where: { id },
      data: { caption, mediaUrl, scheduledFor, metaPostId, ...clientFields },
    });
    await syncContentRow(updated.contentRowId);

    await logActivity(user, {
      action: 'post.update',
      summary:
        updated.scheduledFor.getTime() !== post.scheduledFor.getTime()
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
    if (!canViewScheduling(user)) throw new HttpError(403, strings.errors.notAllowedScheduling);

    const { id } = await context.params;
    const post = await requirePost(id, user.workspaceId);

    if (post.platform === 'facebook' && post.metaPostId && post.status === 'scheduled') {
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

    await prisma.scheduledPost.delete({ where: { id } });
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
