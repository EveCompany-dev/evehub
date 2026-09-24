import { isWorkerPublished, prisma, publishPost } from '@eve/core';
import { metaPublishApi } from '@eve/connector-meta';
import { strings } from '@eve/ui';
import { NextResponse } from 'next/server';
import { logActivity, postLabel } from '../../../../../../lib/activity';
import { fail, handle, ok } from '../../../../../../lib/api';
import { requireUser } from '../../../../../../lib/session';
import { requireManagedPost } from '../../../post-access';

export const runtime = 'nodejs';

/**
 * "Postar agora", and "Tentar de novo" on a failed post: publishes in this
 * request through the same function the worker uses, and answers with what
 * actually happened. The same claim guards both, so a click racing the
 * worker's tick publishes once — whoever loses is told the other has it.
 *
 * - 200 `published`: Meta confirmed it.
 * - 202 `processing`: Instagram is still processing the media; the row is
 *   scheduled again and the worker finishes it. Nothing more to click.
 * - 409: already publishing (the worker has it), or already published.
 * - 502 `failed`: Meta's error, now on the row too.
 */
export async function POST(_request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const user = await requireUser();
    const { id } = await context.params;
    const post = await requireManagedPost(id, user);

    if (!isWorkerPublished(post)) return fail(400, strings.scheduling.facebookFeedPublishesItself);
    if (post.status === 'published') return fail(409, strings.scheduling.alreadyPublished);
    if (post.status === 'publishing') return fail(409, strings.scheduling.takenByWorker);

    const outcome = await publishPost(id, metaPublishApi, { mode: 'now', allowFailed: true });
    const current = await prisma.scheduledPost.findUnique({ where: { id } });

    if (outcome.kind === 'skipped') {
      return outcome.reason === 'not-found' ? fail(404, strings.errors.notFound) : fail(409, strings.scheduling.takenByWorker);
    }

    await logActivity(user, {
      action: 'post.publish',
      summary: `${post.status === 'failed' ? 'tentou de novo' : 'publicou agora'} o post (${postLabel(post)})`,
      entityType: 'scheduledPost',
      entityId: id,
    });

    if (outcome.kind === 'published') return ok({ outcome: 'published', message: strings.scheduling.published, post: current });
    if (outcome.kind === 'processing') return ok({ outcome: 'processing', message: strings.scheduling.processing, post: current }, 202);
    return NextResponse.json({ outcome: 'failed', error: outcome.message, post: current }, { status: 502 });
  });
}
