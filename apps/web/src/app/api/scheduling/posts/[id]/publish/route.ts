import { prisma, publishScheduledPost } from '@eve/core';
import { strings } from '@eve/ui';
import { fail, handle, ok } from '../../../../../../lib/api';
import { canViewScheduling } from '../../../../../../lib/permissions';
import { HttpError, requireUser } from '../../../../../../lib/session';

export const runtime = 'nodejs';

/**
 * Publishes a post right now, from the app, without the worker.
 *
 * "Postar agora" used to mean "write a row dated now and hope the background
 * worker picks it up", which made an invisible process the only thing that
 * could ever publish anything: with it stopped, posts sat at `scheduled` past
 * their time in silence. This is the same publish the worker runs — one
 * implementation, called directly — so the person clicking the button gets
 * either a published post or the actual reason it did not publish, in the
 * response, immediately.
 *
 * Also the retry path an overdue, failed or stuck post never had: the
 * publisher is re-entrant, so calling this on any of those resumes rather
 * than duplicates.
 */
export async function POST(_request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const user = await requireUser();
    if (!canViewScheduling(user)) throw new HttpError(403, strings.errors.notAllowedScheduling);

    const { id } = await context.params;

    // Scoped to the caller's workspace before publishing anything: the
    // publisher itself takes only an id and would happily publish another
    // workspace's post.
    const post = await prisma.scheduledPost.findUnique({ where: { id }, select: { workspaceId: true } });
    if (!post || post.workspaceId !== user.workspaceId) throw new HttpError(404, strings.errors.notFound);

    const outcome = await publishScheduledPost(id, { inlinePoll: true });

    if (outcome.status === 'failed') return fail(502, outcome.message);
    if (outcome.status === 'busy') return fail(409, outcome.message);

    return ok({
      status: outcome.status,
      ...(outcome.status === 'processing' ? { message: outcome.message } : { alreadyPublished: outcome.alreadyPublished }),
    });
  });
}
