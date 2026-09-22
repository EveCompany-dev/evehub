import { prisma } from '@eve/core';
import { strings } from '@eve/ui';
import { logActivity, quoted } from '../../../../../../lib/activity';
import { fail, handle, ok } from '../../../../../../lib/api';
import { requireJob } from '../../../../../../lib/jobs';
import { HttpError, requireUser } from '../../../../../../lib/session';

export const runtime = 'nodejs';

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string; commentId: string }> },
): Promise<Response> {
  return handle(async () => {
    const user = await requireUser();
    const { id, commentId } = await context.params;
    const job = await requireJob(id, user.workspaceId);

    const comment = await prisma.jobComment.findUnique({ where: { id: commentId } });
    if (!comment || comment.jobId !== id) throw new HttpError(404, strings.errors.notFound);
    if (comment.authorId !== user.id) return fail(403, strings.errors.notCommentAuthor);

    await prisma.jobComment.delete({ where: { id: commentId } });
    await logActivity(user, {
      action: 'job.comment',
      summary: `apagou um comentário do job ${quoted(job.title)}: ${quoted(comment.body, 120)}`,
      entityType: 'job',
      entityId: id,
    });
    return ok({ ok: true });
  });
}
