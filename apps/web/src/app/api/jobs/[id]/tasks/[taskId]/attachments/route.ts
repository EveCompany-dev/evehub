import { prisma } from '@eve/core';
import { logActivity, quoted } from '../../../../../../../lib/activity';
import { fail, handle, ok } from '../../../../../../../lib/api';
import { JOB_MEMBER_SELECT, requireJob, requireTask } from '../../../../../../../lib/jobs';
import { requireUser } from '../../../../../../../lib/session';
import { ATTACHMENT_EXTENSIONS, ATTACHMENT_TYPES, saveUpload, UploadError } from '../../../../../../../lib/uploads';

export const runtime = 'nodejs';

const MAX_BYTES = 25 * 1024 * 1024;

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string; taskId: string }> },
): Promise<Response> {
  return handle(async () => {
    const user = await requireUser();
    const { id, taskId } = await context.params;
    const job = await requireJob(id, user.workspaceId);
    const task = await requireTask(id, taskId);

    const form = await request.formData();
    const file = form.get('file');
    if (!(file instanceof File)) return fail(400, 'Nenhum arquivo enviado.');

    try {
      const saved = await saveUpload(file, 'attachments', { maxBytes: MAX_BYTES, allowedTypes: ATTACHMENT_TYPES, allowedExtensions: ATTACHMENT_EXTENSIONS });
      const attachment = await prisma.attachment.create({
        data: { taskId, uploadedBy: user.id, filename: file.name, url: saved.url, size: saved.size },
        include: { uploader: { select: JOB_MEMBER_SELECT } },
      });
      await logActivity(user, {
        action: 'job.attachment',
        summary: `anexou ${quoted(file.name)} na tarefa ${quoted(task.title)} do job ${quoted(job.title)}`,
        entityType: 'job',
        entityId: id,
      });
      return ok({ attachment }, 201);
    } catch (error) {
      if (error instanceof UploadError) return fail(400, error.message);
      throw error;
    }
  });
}
