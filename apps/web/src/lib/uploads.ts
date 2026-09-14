import { randomUUID } from 'node:crypto';
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';

/**
 * Local-disk storage shared by every upload feature in the app (dashboard
 * background image, job task attachments, ...) — one convention instead of
 * each feature inventing its own. Files land under `apps/web/public/uploads`
 * so Next's static file server exposes them at `/uploads/...` with zero
 * extra routing; `public/uploads` is gitignored, this is user content, not
 * source.
 */
const UPLOAD_ROOT = path.join(process.cwd(), 'public', 'uploads');

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
 * Saves an uploaded file under `public/uploads/<subdir>/`, naming it with a
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

  const dir = path.join(UPLOAD_ROOT, subdir);
  await mkdir(dir, { recursive: true });

  const ext = safeExtension(file.name);
  const filename = `${randomUUID()}${ext}`;
  const buffer = Buffer.from(await file.arrayBuffer());
  await writeFile(path.join(dir, filename), buffer);

  return { url: `/uploads/${subdir}/${filename}`, filename, size: file.size };
}

/** Best-effort delete — a missing file (already gone, or never existed) is not an error worth surfacing. */
export async function deleteUpload(url: string): Promise<void> {
  if (!url.startsWith('/uploads/')) return;
  try {
    await unlink(path.join(process.cwd(), 'public', url));
  } catch {
    // Already gone — fine.
  }
}
