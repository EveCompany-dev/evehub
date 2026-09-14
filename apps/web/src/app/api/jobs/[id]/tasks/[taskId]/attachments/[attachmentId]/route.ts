import { prisma } from '@eve/core';
import { strings } from '@eve/ui';
import { handle, ok } from '../../../../../../../../lib/api';
import { requireJob, requireTask } from '../../../../../../../../lib/jobs';
import { HttpError, requireUser } from '../../../../../../../../lib/session';
import { deleteUpload } from '../../../../../../../../lib/uploads';

export const runtime = 'nodejs';

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string; taskId: string; attachmentId: string }> },
): Promise<Response> {
  return handle(async () => {
    const user = await requireUser();
    const { id, taskId, attachmentId } = await context.params;
    await requireJob(id, user.workspaceId);
    await requireTask(id, taskId);

    const attachment = await prisma.attachment.findUnique({ where: { id: attachmentId } });
    if (!attachment || attachment.taskId !== taskId) throw new HttpError(404, strings.errors.notFound);

    await prisma.attachment.delete({ where: { id: attachmentId } });
    await deleteUpload(attachment.url);

    return ok({ ok: true });
  });
}
