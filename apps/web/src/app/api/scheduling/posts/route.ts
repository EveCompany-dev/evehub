import { loadConnectorContext, prisma, type PostStatus, type PostType } from '@eve/core';
import { scheduleFacebookPost, type MetaConfig, type MetaCredentials } from '@eve/connector-meta';
import { strings } from '@eve/ui';
import { z } from 'zod';
import { fail, handle, ok } from '../../../../lib/api';
import { canViewScheduling } from '../../../../lib/permissions';
import { HttpError, requireInstance, requireUser } from '../../../../lib/session';

export const runtime = 'nodejs';

const MIN_LEAD_MS = 10 * 60 * 1000; // Meta rejects a Facebook schedule under ~10 minutes out.
const MAX_LEAD_MS = 75 * 24 * 60 * 60 * 1000; // ...and past 75 days.
const POST_STATUSES: PostStatus[] = ['draft', 'scheduled', 'publishing', 'published', 'failed'];

const createSchema = z.object({
  connectorInstanceId: z.string().min(1),
  client: z.object({
    id: z.string().min(1),
    label: z.string().min(1),
  }),
  platform: z.enum(['instagram', 'facebook']),
  postType: z.enum(['feed', 'story']).default('feed'),
  caption: z.string().max(2200),
  mediaUrl: z.string().url(),
  scheduledFor: z.string().datetime(),
});

/** Lists scheduled posts for the calendar, filterable by date range/client/platform/status. */
export async function GET(request: Request): Promise<Response> {
  return handle(async () => {
    const user = await requireUser();
    if (!canViewScheduling(user)) throw new HttpError(403, strings.errors.notAllowedScheduling);

    const url = new URL(request.url);
    const from = url.searchParams.get('from');
    const to = url.searchParams.get('to');
    const clientId = url.searchParams.get('client');
    const platform = url.searchParams.get('platform');
    const status = url.searchParams.get('status');

    const statusFilter = status && POST_STATUSES.includes(status as PostStatus) ? (status as PostStatus) : null;

    const posts = await prisma.scheduledPost.findMany({
      where: {
        workspaceId: user.workspaceId,
        ...(from || to
          ? { scheduledFor: { ...(from ? { gte: new Date(from) } : {}), ...(to ? { lte: new Date(to) } : {}) } }
          : {}),
        ...(platform === 'instagram' || platform === 'facebook' ? { platform } : {}),
        ...(statusFilter ? { status: statusFilter } : {}),
        ...(clientId ? { clientId } : {}),
      },
      orderBy: { scheduledFor: 'asc' },
    });

    return ok({ posts });
  });
}

/**
 * Creates a scheduled post. Facebook FEED submits to Meta immediately with a
 * future `scheduled_publish_time` — Meta's own infrastructure fires it.
 * Instagram (feed or story) and Facebook Stories have no native scheduling,
 * so those rows are stored `scheduled` with no Meta call yet; the worker's
 * SCHEDULING_TICK job fires them later.
 */
export async function POST(request: Request): Promise<Response> {
  return handle(async () => {
    const user = await requireUser();
    if (!canViewScheduling(user)) throw new HttpError(403, strings.errors.notAllowedScheduling);

    const body = createSchema.safeParse(await request.json());
    if (!body.success) return fail(400, body.error.issues.map((issue) => issue.message).join('; '));

    const instance = await requireInstance(body.data.connectorInstanceId, user);
    if (instance.connectorId !== 'meta') return fail(400, 'A instância informada não é uma conexão do Meta.');

    let config: MetaConfig;
    let credentials: MetaCredentials;
    try {
      const loaded = loadConnectorContext(instance);
      config = loaded.ctx.config as MetaConfig;
      credentials = loaded.ctx.credentials as MetaCredentials;
    } catch (error) {
      return fail(400, error instanceof Error ? error.message : String(error));
    }
    const scheduledFor = new Date(body.data.scheduledFor);
    const leadMs = scheduledFor.getTime() - Date.now();
    const postType: PostType = body.data.postType;

    const clientFields = {
      clientSource: 'local' as const,
      clientId: body.data.client.id,
      clientRemoteId: null,
      clientLabel: body.data.client.label,
    };

    if (body.data.platform === 'facebook' && postType === 'feed') {
      if (leadMs < MIN_LEAD_MS || leadMs > MAX_LEAD_MS) {
        return fail(400, 'O Facebook so agenda posts entre 10 minutos e 75 dias no futuro.');
      }

      let scheduled;
      try {
        scheduled = await scheduleFacebookPost(
          credentials.pageAccessToken,
          config.pageId,
          body.data.mediaUrl,
          body.data.caption,
          Math.floor(scheduledFor.getTime() / 1000),
        );
      } catch (error) {
        return fail(502, error instanceof Error ? error.message : String(error));
      }

      const post = await prisma.scheduledPost.create({
        data: {
          workspaceId: user.workspaceId,
          connectorInstanceId: instance.id,
          ...clientFields,
          platform: 'facebook',
          postType,
          caption: body.data.caption,
          mediaUrl: body.data.mediaUrl,
          scheduledFor,
          status: 'scheduled',
          metaPostId: scheduled.postId,
          createdBy: user.id,
        },
      });

      return ok({ post }, 201);
    }

    // Instagram (feed or story) and Facebook Stories: no Meta call yet, the
    // worker publishes at scheduledFor — nothing to lose from validating
    // config now, before the row even exists.
    if (body.data.platform === 'instagram' && !config.instagramBusinessAccountId) {
      return fail(400, 'Configure o ID da conta do Instagram nesta instancia do Meta antes de agendar.');
    }

    const post = await prisma.scheduledPost.create({
      data: {
        workspaceId: user.workspaceId,
        connectorInstanceId: instance.id,
        ...clientFields,
        platform: body.data.platform,
        postType,
        caption: body.data.caption,
        mediaUrl: body.data.mediaUrl,
        scheduledFor,
        status: 'scheduled',
        createdBy: user.id,
      },
    });

    return ok({ post }, 201);
  });
}
