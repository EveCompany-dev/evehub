import { getEnv, prisma } from '@eve/core';
import { unlink } from 'node:fs/promises';
import path from 'node:path';

/**
 * Where saveUpload() (apps/web/src/lib/uploads.ts) actually wrote the file —
 * has to resolve to the exact same directory that lib does, or deleting here
 * either misses the real file or (worse) reaches outside it. `UPLOADS_DIR`
 * is the shared volume set in docker-compose.yml for production, where web
 * and worker are separate containers. Unset in native dev, where both
 * processes already run on the same machine and this worker's own cwd
 * (apps/worker) sits right next to apps/web.
 */
const UPLOAD_ROOT = getEnv().UPLOADS_DIR ?? path.resolve(process.cwd(), '../web/public/uploads');

function deletableUploadPath(url: string): string | null {
  try {
    const pathname = url.startsWith('/') ? url : new URL(url).pathname;
    if (!pathname.startsWith('/uploads/')) return null;
    return path.join(UPLOAD_ROOT, pathname.slice('/uploads/'.length));
  } catch {
    return null;
  }
}

/**
 * Deletes the local media of scheduled posts that published more than
 * MEDIA_RETENTION_DAYS ago. Meta already downloaded and now hosts its own
 * copy the moment a post went `published` — our copy past that grace window
 * is only there so the calendar's own thumbnail for a recent post still
 * renders, not because anything still needs to fetch it. Best-effort: a
 * file already gone (deleted by a previous run, or never existed) is not an
 * error, same as deleteUpload().
 */
export async function cleanupPublishedMedia(): Promise<number> {
  const cutoff = new Date(Date.now() - getEnv().MEDIA_RETENTION_DAYS * 24 * 60 * 60 * 1000);

  const posts = await prisma.scheduledPost.findMany({
    where: { status: 'published', scheduledFor: { lt: cutoff } },
    select: { mediaUrl: true, mediaUrls: true },
  });

  let removed = 0;
  for (const post of posts) {
    const urls = [post.mediaUrl, ...(Array.isArray(post.mediaUrls) ? (post.mediaUrls as unknown[]) : [])].filter(
      (value): value is string => typeof value === 'string',
    );
    for (const url of urls) {
      const filePath = deletableUploadPath(url);
      if (!filePath) continue;
      try {
        await unlink(filePath);
        removed += 1;
      } catch {
        // Already gone — fine.
      }
    }
  }

  return removed;
}
