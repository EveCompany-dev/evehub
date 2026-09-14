import { getEnv } from '@eve/core';
import { fail, handle, ok } from '../../../../lib/api';
import { requireUser } from '../../../../lib/session';
import { saveUpload, UploadError } from '../../../../lib/uploads';

export const runtime = 'nodejs';

const MAX_BYTES = 8 * 1024 * 1024;
const ALLOWED_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];

/**
 * Unlike the other upload endpoints, this URL has to be fetchable by Meta's
 * own servers (Graph API downloads the media from it), so the response is an
 * absolute URL rather than the usual app-relative `/uploads/...` path.
 *
 * `PUBLIC_BASE_URL` wins when set, because the request's own origin is only
 * the right answer when the app is reached at its public address: in dev it
 * is `http://localhost:3000`, and behind a reverse proxy it is whatever
 * internal host the proxy forwards. Meta cannot reach either, and reports
 * the failed download as "Only photo or video can be accepted as media
 * type", which sounds like a rejected file format and sends you looking in
 * the wrong place entirely.
 */
export async function POST(request: Request): Promise<Response> {
  return handle(async () => {
    await requireUser();

    const form = await request.formData();
    const file = form.get('file');
    if (!(file instanceof File)) return fail(400, 'Nenhum arquivo enviado.');

    try {
      const saved = await saveUpload(file, 'post-media', { maxBytes: MAX_BYTES, allowedTypes: ALLOWED_TYPES });
      const base = getEnv().PUBLIC_BASE_URL ?? request.url;
      return ok({ url: new URL(saved.url, base).toString() });
    } catch (error) {
      if (error instanceof UploadError) return fail(400, error.message);
      throw error;
    }
  });
}
