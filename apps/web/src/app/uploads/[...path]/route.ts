import { stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { UPLOAD_ROOT } from '../../../lib/uploads';

export const runtime = 'nodejs';

/**
 * Fallback for files under public/uploads that Next's own static file server
 * won't serve.
 *
 * `next start` snapshots the public/ directory once at boot (confirmed on
 * production: a file present at build time serves fine; one written to the
 * same folder afterward — every upload, since they're written at runtime by
 * saveUpload() — 404s until the process restarts, and only until the next
 * upload). This route never runs when the static handler already claims a
 * path, so existing behavior for anything already known at boot is
 * untouched; it only ever catches what that handler missed, which in
 * practice is every upload.
 */
const MIME_TYPES: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime',
  '.webm': 'video/webm',
};

export async function GET(_request: Request, context: { params: Promise<{ path: string[] }> }): Promise<Response> {
  const { path: segments } = await context.params;

  // Reject traversal/empty segments outright rather than letting path.join
  // normalize them away — a segment of ".." must never reach the filesystem call.
  if (segments.length === 0 || segments.some((segment) => !segment || segment === '..' || segment.includes('/'))) {
    return new Response('Not found', { status: 404 });
  }

  const filePath = path.join(UPLOAD_ROOT, ...segments);
  if (!filePath.startsWith(UPLOAD_ROOT + path.sep)) {
    return new Response('Not found', { status: 404 });
  }

  let size: number;
  try {
    const stats = await stat(filePath);
    if (!stats.isFile()) return new Response('Not found', { status: 404 });
    size = stats.size;
  } catch {
    return new Response('Not found', { status: 404 });
  }

  const contentType = MIME_TYPES[path.extname(filePath).toLowerCase()] ?? 'application/octet-stream';
  const stream = Readable.toWeb(createReadStream(filePath)) as ReadableStream;

  return new Response(stream, {
    headers: {
      'Content-Type': contentType,
      'Content-Length': String(size),
      // Uploaded files are named with a random id and never reused — safe to cache indefinitely.
      'Cache-Control': 'public, max-age=31536000, immutable',
    },
  });
}
