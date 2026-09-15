import { fail, handle, ok } from '../../../../lib/api';
import { requireUser } from '../../../../lib/session';
import { saveUpload, UploadError } from '../../../../lib/uploads';

export const runtime = 'nodejs';

/**
 * Images pasted or dropped onto the board. Same storage convention as every
 * other upload; a separate subdir so board images can be reasoned about (and
 * cleaned up) apart from backgrounds and attachments.
 *
 * The limit is higher than the dashboard background's 5MB because a board
 * image is routinely a screenshot of a whole dashboard or report, but the
 * allowed types stay the same short list — it lands in an <img>, nothing else.
 */
const MAX_BYTES = 10 * 1024 * 1024;
const ALLOWED_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];

export async function POST(request: Request): Promise<Response> {
  return handle(async () => {
    await requireUser();

    const form = await request.formData();
    const file = form.get('file');
    if (!(file instanceof File)) return fail(400, 'Nenhum arquivo enviado.');

    try {
      const saved = await saveUpload(file, 'canvas', { maxBytes: MAX_BYTES, allowedTypes: ALLOWED_TYPES });
      return ok({ url: saved.url });
    } catch (error) {
      if (error instanceof UploadError) return fail(400, error.message);
      throw error;
    }
  });
}
