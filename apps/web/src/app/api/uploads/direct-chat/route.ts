import { fail, handle, ok } from '../../../../lib/api';
import { requireUser } from '../../../../lib/session';
import { saveUpload, UploadError } from '../../../../lib/uploads';

export const runtime = 'nodejs';

const MAX_BYTES = 25 * 1024 * 1024;

export async function POST(request: Request): Promise<Response> {
  return handle(async () => {
    await requireUser();

    const form = await request.formData();
    const file = form.get('file');
    if (!(file instanceof File)) return fail(400, 'Nenhum arquivo enviado.');

    try {
      const saved = await saveUpload(file, 'direct-chat', { maxBytes: MAX_BYTES });
      return ok({ filename: file.name, url: saved.url, size: saved.size });
    } catch (error) {
      if (error instanceof UploadError) return fail(400, error.message);
      throw error;
    }
  });
}
