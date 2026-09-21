import { fail, handle, ok } from '../../../lib/api';
import { fetchLinkPreview, type LinkPreview } from '../../../lib/link-preview';
import { requireUser } from '../../../lib/session';

export const runtime = 'nodejs';

const TTL_MS = 6 * 60 * 60 * 1000;
const MAX_ENTRIES = 500;
// Gallery pages ask for the same links over and over; one fetch per link per few hours is plenty.
const cache = new Map<string, { at: number; preview: LinkPreview | null }>();

/** The picture a link declares for itself (og:image), for gallery covers. Never fails the page: no preview is a normal answer. */
export async function GET(request: Request): Promise<Response> {
  return handle(async () => {
    await requireUser();
    const url = new URL(request.url).searchParams.get('url') ?? '';
    if (!/^https?:\/\//i.test(url) || url.length > 2000) return fail(400, 'Link inválido.');

    const hit = cache.get(url);
    if (hit && Date.now() - hit.at < TTL_MS) return ok({ preview: hit.preview });

    let preview: LinkPreview | null = null;
    try {
      preview = await fetchLinkPreview(url);
    } catch {
      preview = null;
    }
    if (cache.size >= MAX_ENTRIES) cache.delete(cache.keys().next().value!);
    cache.set(url, { at: Date.now(), preview });
    return ok({ preview });
  });
}
