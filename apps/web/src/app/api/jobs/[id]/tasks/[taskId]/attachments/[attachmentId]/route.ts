import { prisma } from '@eve/core';
import { strings } from '@eve/ui';
import { logActivity, quoted } from '../../../../../../../../lib/activity';
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
    const job = await requireJob(id, user);
    const task = await requireTask(id, taskId);

    const attachment = await prisma.attachment.findUnique({ where: { id: attachmentId } });
    if (!attachment || attachment.taskId !== taskId) throw new HttpError(404, strings.errors.notFound);

    await prisma.attachment.delete({ where: { id: attachmentId } });
    await deleteUpload(attachment.url);
    await logActivity(user, {
      action: 'job.attachment',
      summary: `apagou o anexo ${quoted(attachment.filename)} da tarefa ${quoted(task.title)} do job ${quoted(job.title)}`,
      entityType: 'job',
      entityId: id,
    });

    return ok({ ok: true });
  });
}
