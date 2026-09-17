import { getEnv } from '@eve/core';
import { randomUUID } from 'node:crypto';
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';

/**
 * Local-disk storage shared by every upload feature in the app (dashboard
 * background image, job task attachments, ...) — one convention instead of
 * each feature inventing its own. Files land under `UPLOADS_DIR` (a volume
 * shared with the worker container in production — see docker-compose.yml
 * and apps/worker/src/media-cleanup.ts) or, when that's unset (native dev,
 * where web and worker already share one filesystem), the same
 * `apps/web/public/uploads` this always used. Either way this app exposes
 * them at `/uploads/...`: Next's own static file server serves whatever it
 * already knew about at boot, and the fallback route in
 * app/uploads/[...path]/route.ts covers everything written since (in
 * practice, every upload — see that route's own comment for why). `public/
 * uploads` is gitignored either way, this is user content, not source.
 */
// A function, not a top-level constant: calling getEnv() at module load makes
// Next's build-time page-data collection evaluate it too, and that
// environment has no DATABASE_URL/CREDENTIALS_KEY — it would fail every route
// that imports this file. Deferring to call time keeps it out of the build
// and only runs it against the real runtime environment.
export function getUploadRoot(): string {
  return getEnv().UPLOADS_DIR ?? path.join(process.cwd(), 'public', 'uploads');
}

export class UploadError extends Error {}

function safeExtension(filename: string): string {
  const ext = path.extname(filename).toLowerCase().replace(/[^a-z0-9.]/g, '');
  return ext.length > 1 && ext.length <= 10 ? ext : '';
}

export interface SavedUpload {
  url: string;
  filename: string;
  size: number;
}

/**
 * Saves an uploaded file under `UPLOAD_ROOT/<subdir>/`, naming it with a
 * random id (never the caller-supplied filename) to avoid path traversal and
 * collisions. `subdir` must be a single path-safe segment chosen by the
 * caller (e.g. "backgrounds", "attachments") — never derived from user input.
 */
export async function saveUpload(
  file: File,
  subdir: string,
  options: { maxBytes: number; allowedTypes?: string[] },
): Promise<SavedUpload> {
  if (file.size === 0) throw new UploadError('Arquivo vazio.');
  if (file.size > options.maxBytes) {
    throw new UploadError(`Arquivo maior que o limite de ${Math.round(options.maxBytes / 1024 / 1024)}MB.`);
  }
  if (options.allowedTypes && !options.allowedTypes.includes(file.type)) {
    throw new UploadError('Tipo de arquivo não permitido.');
  }

  const dir = path.join(getUploadRoot(), subdir);
  await mkdir(dir, { recursive: true });

  const ext = safeExtension(file.name);
  const filename = `${randomUUID()}${ext}`;
  const buffer = Buffer.from(await file.arrayBuffer());
  await writeFile(path.join(dir, filename), buffer);

  return { url: `/uploads/${subdir}/${filename}`, filename, size: file.size };
}

/**
 * Best-effort delete — a missing file (already gone, or never existed) is
 * not an error worth surfacing. Accepts either the app-relative form
 * (`/uploads/...`, what most callers store) or the absolute form
 * (`https://.../uploads/...`, what ScheduledPost.mediaUrl stores — Meta has
 * to be able to fetch it, so post-media's own upload route always returns
 * an absolute URL) by reading only the pathname.
 */
export async function deleteUpload(url: string): Promise<void> {
  try {
    const pathname = url.startsWith('/') ? url : new URL(url).pathname;
    if (!pathname.startsWith('/uploads/')) return;
    await unlink(path.join(getUploadRoot(), pathname.slice('/uploads/'.length)));
  } catch {
    // Already gone, or an unparseable url — either way, nothing more to do.
  }
}
