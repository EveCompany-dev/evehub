/**
 * Minimal zip reader (stored + deflate entries), enough to open a Notion
 * "Export" archive in the browser without shipping a zip library. Uses the
 * platform's DecompressionStream, so it works in current browsers and Node.
 * Encrypted, ZIP64 and split archives are refused with a readable error.
 */

export interface ZipEntry {
  name: string;
  read: () => Promise<Uint8Array>;
}

export class ZipError extends Error {}

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;

async function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
  if (typeof DecompressionStream === 'undefined') {
    throw new ZipError('Este navegador não consegue abrir arquivos .zip. Extraia o zip e envie os .csv.');
  }
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export function readZipEntries(buffer: ArrayBuffer | Uint8Array): ZipEntry[] {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 65535); i -= 1) {
    if (view.getUint32(i, true) === EOCD_SIGNATURE) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new ZipError('Arquivo .zip inválido ou corrompido.');

  const total = view.getUint16(eocd + 10, true);
  let offset = view.getUint32(eocd + 16, true);
  if (total === 0xffff || offset === 0xffffffff) throw new ZipError('Arquivos .zip muito grandes (ZIP64) não são suportados.');

  const decoder = new TextDecoder('utf-8');
  const entries: ZipEntry[] = [];

  for (let index = 0; index < total; index += 1) {
    if (offset + 46 > bytes.length || view.getUint32(offset, true) !== CENTRAL_SIGNATURE) {
      throw new ZipError('Diretório do .zip corrompido.');
    }
    const flags = view.getUint16(offset + 8, true);
    const method = view.getUint16(offset + 10, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const localOffset = view.getUint32(offset + 42, true);
    // The spec says "/", but Windows PowerShell's Compress-Archive (5.1) writes "\" — a zip
    // re-packed on Windows would otherwise import as one giant file name with the folders in it.
    const name = decoder.decode(bytes.subarray(offset + 46, offset + 46 + nameLength)).replace(/\\/g, '/');
    offset += 46 + nameLength + extraLength + commentLength;

    if (name.endsWith('/')) continue; // directory

    entries.push({
      name,
      read: async () => {
        if (flags & 1) throw new ZipError(`"${name}" está protegido por senha.`);
        if (view.getUint32(localOffset, true) !== LOCAL_SIGNATURE) throw new ZipError(`"${name}" está corrompido no .zip.`);
        const localNameLength = view.getUint16(localOffset + 26, true);
        const localExtraLength = view.getUint16(localOffset + 28, true);
        const start = localOffset + 30 + localNameLength + localExtraLength;
        const data = bytes.subarray(start, start + compressedSize);
        if (method === 0) return data;
        if (method === 8) return inflateRaw(data);
        throw new ZipError(`"${name}" usa um método de compressão não suportado (${method}).`);
      },
    });
  }

  return entries;
}

export interface ExtractedFile {
  /** Path inside the archive (or the plain file name for a loose upload). */
  path: string;
  bytes: Uint8Array;
}

/**
 * Every .csv inside a zip, descending into nested zips (large Notion exports
 * are an outer zip holding "-Part-N.zip" files). macOS resource-fork clutter
 * is skipped.
 */
export async function extractCsvFiles(buffer: ArrayBuffer | Uint8Array, depth = 0): Promise<ExtractedFile[]> {
  const out: ExtractedFile[] = [];
  for (const entry of readZipEntries(buffer)) {
    const lower = entry.name.toLowerCase();
    if (lower.startsWith('__macosx/') || lower.split('/').some((part) => part.startsWith('._'))) continue;
    if (lower.endsWith('.csv')) {
      out.push({ path: entry.name, bytes: await entry.read() });
    } else if (lower.endsWith('.zip') && depth < 2) {
      const inner = await extractCsvFiles(await entry.read(), depth + 1);
      out.push(...inner.map((file) => ({ ...file, path: `${entry.name}/${file.path}` })));
    }
  }
  return out;
}
