import { getEnv } from '@eve/core';
import { randomUUID } from 'node:crypto';
import { existsSync, renameSync } from 'node:fs';
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';

/**
 * Local-disk storage shared by every upload feature in the app (dashboard
 * background image, job task attachments, ...) — one convention instead of
 * each feature inventing its own. Files land under `UPLOADS_DIR` (a volume
 * shared with the worker container in production — see docker-compose.yml
 * and apps/worker/src/media-cleanup.ts) or, when that's unset, in
 * `apps/web/.uploads`. Either way they are served only by the route in
 * app/uploads/[...path]/route.ts, which sets the Content-Type itself.
 *
 * The default deliberately sits OUTSIDE `public/`. Next serves `public/` with
 * a Content-Type derived from the file extension, so an uploaded `.svg` or
 * `.html` under `public/uploads` renders as a document on this app's own
 * origin — stored XSS with the viewer's session. Keeping user content out of
 * the web root means the static handler can never claim these paths, and the
 * one route that does serve them decides the Content-Type.
 */
// A function, not a top-level constant: calling getEnv() at module load makes
// Next's build-time page-data collection evaluate it too, and that
// environment has no DATABASE_URL/CREDENTIALS_KEY — it would fail every route
// that imports this file. Deferring to call time keeps it out of the build
// and only runs it against the real runtime environment.
export function getUploadRoot(): string {
  const configured = getEnv().UPLOADS_DIR;
  if (configured) return configured;
  const root = path.join(/*turbopackIgnore: true*/ process.cwd(), '.uploads');
  if (!legacyMoveChecked) {
    legacyMoveChecked = true;
    moveLegacyUploads(root);
  }
  return root;
}

let legacyMoveChecked = false;

/**
 * Installs from before the move kept uploads in `public/uploads`. Moving them
 * once, on first use, means an update needs no manual step: avatars, logos and
 * attachments keep resolving at the same `/uploads/...` URLs. Skipped (and
 * logged) when both folders exist, so nothing is ever merged or overwritten.
 */
function moveLegacyUploads(root: string): void {
  const legacy = path.join(/*turbopackIgnore: true*/ process.cwd(), 'public', 'uploads');
  try {
    if (!existsSync(legacy)) return;
    if (existsSync(root)) {
      console.warn(`[uploads] ${legacy} e ${root} existem; nada foi movido. Junte os dois a mao.`);
      return;
    }
    renameSync(legacy, root);
    console.log(`[uploads] uploads antigos movidos de ${legacy} para ${root}.`);
  } catch (error) {
    console.error('[uploads] falha ao mover os uploads antigos:', error);
  }
}

/**
 * The exact shape `saveUpload` hands back. Anything that accepts an upload URL
 * from a client validates against this, so a stored attachment url can only
 * ever name a real upload — it is read back later by `deleteUpload`, and a
 * free-form string there is a filesystem write primitive.
 */
export const UPLOAD_URL_PATTERN = /^\/uploads\/[a-z0-9-]+\/[0-9a-fA-F-]{36}(\.[a-z0-9]{1,10})?$/;

/**
 * What a person may attach to a chat message, a job task or a bug report:
 * documents and media people actually share, and nothing a browser will
 * execute or render as a document on this origin.
 *
 * Note `file.type` is the Content-Type the CLIENT declared in the multipart
 * body, so this is not proof of the file's contents — it is one layer. The
 * others are `safeExtension` (drops executable extensions whatever the type
 * says) and the serving route, which sets the Content-Type from its own map
 * and sends `nosniff`.
 */
export const ATTACHMENT_TYPES = [
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
  'video/mp4',
  'video/quicktime',
  'video/webm',
  'audio/mpeg',
  'audio/ogg',
  'audio/wav',
  'application/pdf',
  'text/plain',
  'text/csv',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  // Design files — this is a marketing agency, so .psd/.ai/.eps move between
  // people as routinely as images do. Left out, an allowlist that looks
  // reasonable quietly blocks the team's actual work.
  'image/vnd.adobe.photoshop',
  'application/x-photoshop',
  'application/postscript',
  'application/illustrator',
  // Deliberately NOT image/svg+xml. An SVG is a document that can carry
  // script, and it is the whole reason this allowlist exists — `safeExtension`
  // would strip the extension and the serving route would hand it back as a
  // download anyway, so allowing the type would buy a file nobody can preview
  // while inviting someone later to "fix" the preview and reopen the hole.
  // Zip it to share one.
  // Archives, for handing over a folder of assets.
  'application/zip',
  'application/x-zip-compressed',
  'application/vnd.rar',
  'application/x-rar-compressed',
  'application/x-7z-compressed',
  'application/gzip',
  'application/x-tar',
];

export class UploadError extends Error {}

/**
 * Extensions a browser will execute or render as a document. A file saved
 * without an extension is served as application/octet-stream, which downloads
 * instead of running — so dropping the extension is the safe outcome here.
 * This is the backstop; the per-route `allowedTypes` is the real gate.
 */
const EXECUTABLE_EXTENSIONS = new Set(['.svg', '.svgz', '.html', '.htm', '.xhtml', '.xml', '.js', '.mjs']);

function safeExtension(filename: string): string {
  const ext = path.extname(filename).toLowerCase().replace(/[^a-z0-9.]/g, '');
  if (ext.length <= 1 || ext.length > 10) return '';
  return EXECUTABLE_EXTENSIONS.has(ext) ? '' : ext;
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
 * Resolves an upload URL to the file it names, or null when it names anything
 * else. Accepts the app-relative form (`/uploads/...`, what most callers
 * store) and the absolute form (`https://.../uploads/...`, what
 * ScheduledPost.mediaUrl stores — Meta has to be able to fetch it, so
 * post-media's upload route returns an absolute URL).
 *
 * Both forms go through `URL`, which collapses `..` before anything reaches
 * the filesystem. Parsing the relative form by hand was the bug: a stored url
 * of `/uploads/../../etc/passwd` passed a `startsWith('/uploads/')` check and
 * then escaped the root in `path.join`, turning any field that accepts an
 * attachment url into an arbitrary-delete primitive. The containment check
 * below is kept as well, so a future caller cannot reintroduce it.
 */
export function resolveUploadPath(url: string): string | null {
  let pathname: string;
  try {
    // A base makes the relative form parse; an absolute url ignores it.
    pathname = new URL(url, 'http://uploads.invalid').pathname;
  } catch {
    return null;
  }
  if (!pathname.startsWith('/uploads/')) return null;

  const root = getUploadRoot();
  const resolved = path.resolve(root, pathname.slice('/uploads/'.length));
  return resolved.startsWith(root + path.sep) ? resolved : null;
}

/**
 * Best-effort delete — a file that is already gone is not an error worth
 * surfacing. Anything else is logged: this used to swallow every outcome,
 * which is what kept the traversal above invisible.
 */
export async function deleteUpload(url: string): Promise<void> {
  const target = resolveUploadPath(url);
  if (!target) {
    console.warn('[uploads] ignorando delete de um caminho fora de UPLOAD_ROOT:', url);
    return;
  }

  try {
    await unlink(target);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      console.error('[uploads] falha ao apagar o arquivo:', error);
    }
  }
}
