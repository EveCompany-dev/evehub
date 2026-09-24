import { stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { getUploadRoot } from '../../../lib/uploads';
import { getSessionUser } from '../../../lib/session';

export const runtime = 'nodejs';

/**
 * The one subdirectory that stays public. Meta's servers fetch a scheduled
 * post's image from the URL we hand them, so requiring a session here would
 * break publishing. Everything else — avatars, chat and DM attachments,
 * bug-report screenshots — is workspace material and needs one.
 */
const PUBLIC_SUBDIRS = new Set(['post-media']);

/**
 * The only server for user uploads.
 *
 * Uploads used to live in `public/uploads`, where Next's static handler served
 * whatever it had snapshotted at boot and this route caught the rest. That
 * split was the problem: the static handler sets the Content-Type from the
 * file extension, so an uploaded `.svg` or `.html` rendered as a document on
 * this app's own origin. The upload root now sits outside `public/` (see
 * lib/uploads.ts), which means the static handler can never claim these paths
 * and this route alone decides the type, the headers and who may read them.
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

  // 404 rather than 401 for an unauthenticated request: the response should not
  // confirm whether a given upload URL exists.
  if (!PUBLIC_SUBDIRS.has(segments[0]!) && !(await getSessionUser())) {
    return new Response('Not found', { status: 404 });
  }

  const uploadRoot = getUploadRoot();
  const filePath = path.join(uploadRoot, ...segments);
  if (!filePath.startsWith(uploadRoot + path.sep)) {
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

  // Only the types in the map are served as themselves. Anything else — a PDF,
  // a document, or a file whose extension was stripped as executable — is an
  // octet-stream download, so nothing user-uploaded can render as a document
  // on this origin.
  const known = MIME_TYPES[path.extname(filePath).toLowerCase()];
  const stream = Readable.toWeb(createReadStream(filePath)) as ReadableStream;

  return new Response(stream, {
    headers: {
      'Content-Type': known ?? 'application/octet-stream',
      'Content-Length': String(size),
      // Uploaded files are named with a random id and never reused — safe to cache indefinitely.
      'Cache-Control': 'public, max-age=31536000, immutable',
      // Don't let a browser second-guess the type above and execute the file.
      'X-Content-Type-Options': 'nosniff',
      // `inline` for the image and video types the app renders directly
      // (avatars, chat previews); anything else downloads instead of opening.
      'Content-Disposition': known ? 'inline' : 'attachment',
      // Belt and braces: even if something did render, it can load nothing and
      // run nothing.
      'Content-Security-Policy': "default-src 'none'; sandbox",
    },
  });
}
