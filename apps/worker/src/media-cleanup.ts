import { getEnv, prisma } from '@eve/core';
import { unlink } from 'node:fs/promises';
import path from 'node:path';

/**
 * Where saveUpload() (apps/web/src/lib/uploads.ts) actually wrote the file.
 * `UPLOADS_DIR` is the shared volume set in docker-compose.yml for
 * production, where web and worker are separate containers. Unset in native
 * dev, where this worker's own cwd (apps/worker) sits right next to apps/web.
 * Resolved once, so the containment check below compares like with like.
 */
function uploadRoot(): string {
  return path.resolve(getEnv().UPLOADS_DIR ?? path.resolve(process.cwd(), '../web/.uploads'));
}

const POST_MEDIA_PREFIX = '/uploads/post-media/';

/**
 * The file a post's media URL names, only when it is this app's own post
 * media: the URL's origin is PUBLIC_BASE_URL and its path is directly under
 * /uploads/post-media/. Anything else — another host, another upload folder,
 * a nested path — is not ours to delete, and gets null. Without
 * PUBLIC_BASE_URL there is no way to tell our URLs from anyone else's, so
 * nothing is deleted.
 */
export function ownPostMediaPath(url: string, publicBaseUrl: string | undefined, root: string): string | null {
  if (!publicBaseUrl) return null;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.origin !== new URL(publicBaseUrl).origin) return null;
  if (!parsed.pathname.startsWith(POST_MEDIA_PREFIX)) return null;

  const name = decodeURIComponent(parsed.pathname.slice(POST_MEDIA_PREFIX.length));
  // One flat folder of generated names: no subfolders, no dot segments.
  if (!/^[A-Za-z0-9._-]+$/.test(name) || name.startsWith('.')) return null;

  const resolved = path.resolve(root, 'post-media', name);
  return resolved.startsWith(path.join(root, 'post-media') + path.sep) ? resolved : null;
}

/** Everything that still points at this file, other than posts that are already past retention. */
export type StillReferenced = (fileName: string, cutoff: Date) => Promise<boolean>;

/**
 * A file stays while anything still uses it: a post that is not published
 * yet (or published within the retention window) with it as media or
 * carousel slide, or any Calendário de Conteúdo row (or other table row) that
 * mentions it. Two posts can share one upload, so the older one being past
 * retention is not enough.
 */
const stillReferenced: StillReferenced = async (fileName, cutoff) => {
  const pattern = `%/uploads/post-media/${fileName.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
  const posts = await prisma.$queryRaw<{ found: number }[]>`
    SELECT 1 AS found FROM "ScheduledPost"
    WHERE ("mediaUrl" LIKE ${pattern} OR "mediaUrls"::text LIKE ${pattern})
      AND NOT ("status" = 'published' AND "scheduledFor" < ${cutoff})
    LIMIT 1`;
  if (posts.length > 0) return true;
  const rows = await prisma.$queryRaw<{ found: number }[]>`SELECT 1 AS found FROM "DataTableRow" WHERE "data"::text LIKE ${pattern} LIMIT 1`;
  return rows.length > 0;
};

export interface CleanupDeps {
  publicBaseUrl?: string;
  root?: string;
  retentionDays?: number;
  isReferenced?: StillReferenced;
  remove?: (filePath: string) => Promise<void>;
}

/**
 * Deletes the local media of scheduled posts that published more than
 * MEDIA_RETENTION_DAYS ago. Meta downloaded and hosts its own copy the moment
 * a post went `published`; our copy past that window only kept the
 * calendar's thumbnail working. Cleanup only removes this app's own post
 * media, and never a file something else still uses. Best-effort: a file
 * already gone is not an error.
 */
export async function cleanupPublishedMedia(deps: CleanupDeps = {}): Promise<number> {
  const env = getEnv();
  const publicBaseUrl = 'publicBaseUrl' in deps ? deps.publicBaseUrl : env.PUBLIC_BASE_URL;
  const root = deps.root ?? uploadRoot();
  const cutoff = new Date(Date.now() - (deps.retentionDays ?? env.MEDIA_RETENTION_DAYS) * 24 * 60 * 60 * 1000);
  const isReferenced = deps.isReferenced ?? stillReferenced;
  const remove = deps.remove ?? ((filePath: string) => unlink(filePath));

  if (!publicBaseUrl) return 0;

  const posts = await prisma.scheduledPost.findMany({
    where: { status: 'published', scheduledFor: { lt: cutoff } },
    select: { mediaUrl: true, mediaUrls: true },
  });

  const candidates = new Map<string, string>();
  for (const post of posts) {
    const urls = [post.mediaUrl, ...(Array.isArray(post.mediaUrls) ? (post.mediaUrls as unknown[]) : [])].filter(
      (value): value is string => typeof value === 'string',
    );
    for (const url of urls) {
      const filePath = ownPostMediaPath(url, publicBaseUrl, root);
      if (filePath) candidates.set(filePath, path.basename(filePath));
    }
  }

  let removed = 0;
  for (const [filePath, fileName] of candidates) {
    try {
      if (await isReferenced(fileName, cutoff)) continue;
      await remove(filePath);
      removed += 1;
    } catch {
      // Already gone, or the check failed: keep it, try again next run.
    }
  }
  return removed;
}
