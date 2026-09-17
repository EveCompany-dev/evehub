import { loadConnectorContext, prisma, type PostStatus, type PostType } from '@eve/core';
import {
  ALL_TARGETS,
  assertMediaUrlIsPublic,
  MAX_CAROUSEL_ITEMS,
  mediaKindFromUrl,
  MIN_CAROUSEL_ITEMS,
  scheduleFacebookPost,
  targetAcceptsMedia,
  targetLabel,
  type MetaConfig,
  type MetaCredentials,
} from '@eve/connector-meta';
import { strings } from '@eve/ui';
import { z } from 'zod';
import { fail, handle, ok } from '../../../../lib/api';
import { canViewScheduling } from '../../../../lib/permissions';
import { HttpError, requireInstance, requireUser } from '../../../../lib/session';

export const runtime = 'nodejs';

/**
 * Two identical posts to the same account inside this window are never
 * intentional — they are a double click, a retried request, or an editor that
 * submitted twice. Publishing the same thing twice on a client's feed is the
 * kind of mistake an agency pays for in credibility, so the second submit
 * returns the row the first one made instead of creating another.
 */
const DUPLICATE_WINDOW_MS = 2 * 60 * 1000;

const MIN_LEAD_MS = 10 * 60 * 1000; // Meta rejects a Facebook schedule under ~10 minutes out.
const MAX_LEAD_MS = 75 * 24 * 60 * 60 * 1000; // ...and past 75 days.
const POST_STATUSES: PostStatus[] = ['draft', 'scheduled', 'publishing', 'published', 'failed'];

const createSchema = z.object({
  connectorInstanceId: z.string().min(1),
  client: z.object({
    id: z.string().min(1),
    label: z.string().min(1),
  }),
  /**
   * One submit can fan out to several places at once — IG post + IG story +
   * FB post, say. Each becomes its own ScheduledPost row, because each is
   * published independently and can independently fail; collapsing them into
   * one row would mean a single status that cannot describe "the story went
   * out, the feed post didn't".
   */
  targets: z
    .array(
      z.object({
        platform: z.enum(['instagram', 'facebook']),
        postType: z.enum(['feed', 'story', 'reel']),
      }),
    )
    .min(1, 'Escolha ao menos um destino.')
    .max(ALL_TARGETS.length),
  caption: z.string().max(2200),
  mediaUrl: z.string().url(),
  /** Instagram feed carousel — see the validation below for why this is Instagram-feed-only. */
  mediaUrls: z.array(z.string().url()).min(MIN_CAROUSEL_ITEMS).max(MAX_CAROUSEL_ITEMS).optional(),
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
    const createdBy = url.searchParams.get('createdBy');

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
        ...(createdBy ? { createdBy } : {}),
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

    const clientFields = {
      clientSource: 'local' as const,
      clientId: body.data.client.id,
      clientRemoteId: null,
      clientLabel: body.data.client.label,
    };

    // Meta downloads the media from this URL with its own servers, so an
    // address that only resolves on this machine or LAN can never publish.
    // Rejecting it here — while the user is still looking at the editor and
    // can pick different media or fix the host — beats accepting the post
    // and failing at the scheduled time, hours later, in the worker.
    try {
      assertMediaUrlIsPublic(body.data.mediaUrl);
    } catch (error) {
      return fail(400, error instanceof Error ? error.message : String(error));
    }

    const kind = mediaKindFromUrl(body.data.mediaUrl);

    // The same target twice would publish the same thing twice.
    const targets = body.data.targets.filter(
      (target, index, all) =>
        all.findIndex((other) => other.platform === target.platform && other.postType === target.postType) === index,
    );

    // Carousels only exist on the Instagram feed — Stories/Reels are single-media
    // by definition, and Facebook's multi-photo posting is a different API this
    // app doesn't implement. Rejecting anything else up front (rather than
    // silently posting just the first image, or the worker failing hours later)
    // keeps the guarantee that a stored `mediaUrls` array is always exactly what
    // gets published.
    if (body.data.mediaUrls) {
      if (targets.length !== 1 || targets[0]!.platform !== 'instagram' || targets[0]!.postType !== 'feed') {
        return fail(400, 'Carrossel só pode ser publicado como um único destino: Instagram Feed.');
      }
      const videoUrl = body.data.mediaUrls.find((url) => mediaKindFromUrl(url) === 'video');
      if (videoUrl) return fail(400, 'Carrossel aceita apenas imagens — remova o vídeo.');
      try {
        body.data.mediaUrls.forEach(assertMediaUrlIsPublic);
      } catch (error) {
        return fail(400, error instanceof Error ? error.message : String(error));
      }
    }

    const created = [];
    const errors: string[] = [];

    for (const target of targets) {
      const label = targetLabel(target);

      if (!targetAcceptsMedia(target, kind)) {
        errors.push(
          `${label}: ${kind === 'video' ? 'não aceita vídeo' : 'precisa de um vídeo'} — troque a mídia ou desmarque esse destino.`,
        );
        continue;
      }

      if (target.platform === 'instagram' && !config.instagramBusinessAccountId) {
        errors.push(`${label}: configure o ID da conta do Instagram nesta instância do Meta.`);
        continue;
      }

      // Idempotency, before anything reaches Meta: for Facebook this would
      // otherwise submit a second natively-scheduled post, and for Instagram
      // it would create a second row that publishes separately.
      const recent = await prisma.scheduledPost.findFirst({
        where: {
          workspaceId: user.workspaceId,
          connectorInstanceId: instance.id,
          platform: target.platform,
          postType: target.postType as PostType,
          mediaUrl: body.data.mediaUrl,
          caption: body.data.caption,
          createdAt: { gt: new Date(Date.now() - DUPLICATE_WINDOW_MS) },
        },
      });
      if (recent) {
        created.push(recent);
        continue;
      }

      // Facebook feed is the one target Meta schedules natively, so it is
      // submitted now with a future publish time; everything else is stored
      // and fired by the worker at the scheduled moment.
      if (target.platform === 'facebook' && target.postType === 'feed') {
        if (leadMs < MIN_LEAD_MS || leadMs > MAX_LEAD_MS) {
          errors.push(`${label}: o Facebook só agenda posts entre 10 minutos e 75 dias no futuro.`);
          continue;
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
          errors.push(`${label}: ${error instanceof Error ? error.message : String(error)}`);
          continue;
        }

        created.push(
          await prisma.scheduledPost.create({
            data: {
              workspaceId: user.workspaceId,
              connectorInstanceId: instance.id,
              ...clientFields,
              platform: 'facebook',
              postType: 'feed',
              caption: body.data.caption,
              mediaUrl: body.data.mediaUrl,
              scheduledFor,
              status: 'scheduled',
              metaPostId: scheduled.postId,
              createdBy: user.id,
            },
          }),
        );
        continue;
      }

      created.push(
        await prisma.scheduledPost.create({
          data: {
            workspaceId: user.workspaceId,
            connectorInstanceId: instance.id,
            ...clientFields,
            platform: target.platform,
            postType: target.postType as PostType,
            caption: body.data.caption,
            mediaUrl: body.data.mediaUrl,
            ...(body.data.mediaUrls ? { mediaUrls: body.data.mediaUrls } : {}),
            scheduledFor,
            status: 'scheduled',
            createdBy: user.id,
          },
        }),
      );
    }

    // Nothing got through: this is a plain failure, not a partial success.
    if (created.length === 0) return fail(400, errors.join(' '));

    // Some did: the rows that exist are real and must not be rolled back, so
    // the caller gets both halves and decides what to say about it.
    return ok({ posts: created, errors }, 201);
  });
}
