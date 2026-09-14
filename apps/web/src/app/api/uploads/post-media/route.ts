import { fail, handle, ok } from '../../../../lib/api';
import { requireUser } from '../../../../lib/session';
import { saveUpload, UploadError } from '../../../../lib/uploads';

export const runtime = 'nodejs';

const MAX_BYTES = 8 * 1024 * 1024;
const ALLOWED_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];

/**
 * Unlike the other upload endpoints, this URL has to be fetchable by Meta's
 * own servers (Graph API downloads the media from it), so the response is
 * an absolute URL built from the request's own origin rather than the usual
 * app-relative `/uploads/...` path.
 */
export async function POST(request: Request): Promise<Response> {
  return handle(async () => {
    await requireUser();

    const form = await request.formData();
    const file = form.get('file');
    if (!(file instanceof File)) return fail(400, 'Nenhum arquivo enviado.');

    try {
      const saved = await saveUpload(file, 'post-media', { maxBytes: MAX_BYTES, allowedTypes: ALLOWED_TYPES });
      return ok({ url: new URL(saved.url, request.url).toString() });
    } catch (error) {
      if (error instanceof UploadError) return fail(400, error.message);
      throw error;
    }
  });
}
