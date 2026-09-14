import { prisma } from '@eve/core';
import { fail, handle, ok } from '../../../../../../../lib/api';
import { JOB_MEMBER_SELECT, requireJob, requireTask } from '../../../../../../../lib/jobs';
import { requireUser } from '../../../../../../../lib/session';
import { saveUpload, UploadError } from '../../../../../../../lib/uploads';

export const runtime = 'nodejs';

const MAX_BYTES = 25 * 1024 * 1024;

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string; taskId: string }> },
): Promise<Response> {
  return handle(async () => {
    const user = await requireUser();
    const { id, taskId } = await context.params;
    await requireJob(id, user.workspaceId);
    await requireTask(id, taskId);

    const form = await request.formData();
    const file = form.get('file');
    if (!(file instanceof File)) return fail(400, 'Nenhum arquivo enviado.');

    try {
      const saved = await saveUpload(file, 'attachments', { maxBytes: MAX_BYTES });
      const attachment = await prisma.attachment.create({
        data: { taskId, uploadedBy: user.id, filename: file.name, url: saved.url, size: saved.size },
        include: { uploader: { select: JOB_MEMBER_SELECT } },
      });
      return ok({ attachment }, 201);
    } catch (error) {
      if (error instanceof UploadError) return fail(400, error.message);
      throw error;
    }
  });
}
