import { deflateRawSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { extractCsvFiles, readZipEntries, ZipError } from './zip';

interface FileSpec {
  name: string;
  data: Uint8Array;
  deflate?: boolean;
}

/** Builds a real zip archive (stored or deflated entries) so the reader is tested against the actual format. */
export function makeZip(files: FileSpec[]): Uint8Array {
  const encoder = new TextEncoder();
  const chunks: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;

  for (const file of files) {
    const name = encoder.encode(file.name);
    const payload = file.deflate ? new Uint8Array(deflateRawSync(file.data)) : file.data;
    const local = new Uint8Array(30 + name.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(8, file.deflate ? 8 : 0, true);
    lv.setUint32(18, payload.length, true);
    lv.setUint32(22, file.data.length, true);
    lv.setUint16(26, name.length, true);
    local.set(name, 30);
    chunks.push(local, payload);

    const entry = new Uint8Array(46 + name.length);
    const cv = new DataView(entry.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(10, file.deflate ? 8 : 0, true);
    cv.setUint32(20, payload.length, true);
    cv.setUint32(24, file.data.length, true);
    cv.setUint16(28, name.length, true);
    cv.setUint32(42, offset, true);
    entry.set(name, 46);
    central.push(entry);
    offset += local.length + payload.length;
  }

  const centralSize = central.reduce((sum, entry) => sum + entry.length, 0);
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, files.length, true);
  ev.setUint16(10, files.length, true);
  ev.setUint32(12, centralSize, true);
  ev.setUint32(16, offset, true);

  const all = [...chunks, ...central, eocd];
  const out = new Uint8Array(all.reduce((sum, part) => sum + part.length, 0));
  let cursor = 0;
  for (const part of all) {
    out.set(part, cursor);
    cursor += part.length;
  }
  return out;
}

const text = (value: string) => new TextEncoder().encode(value);

describe('zip reader', () => {
  it('reads stored and deflated entries', async () => {
    const zip = makeZip([
      { name: 'a.txt', data: text('hello') },
      { name: 'dir/b.txt', data: text('world '.repeat(200)), deflate: true },
    ]);
    const entries = readZipEntries(zip);
    expect(entries.map((entry) => entry.name)).toEqual(['a.txt', 'dir/b.txt']);
    expect(new TextDecoder().decode(await entries[0]!.read())).toBe('hello');
    expect(new TextDecoder().decode(await entries[1]!.read())).toBe('world '.repeat(200));
  });

  it('normalizes the backslash paths Windows PowerShell writes', () => {
    const zip = makeZip([{ name: 'Export\\Eve\\Postagens 0123456789abcdef0123456789abcdef.csv', data: text('a') }]);
    expect(readZipEntries(zip).map((entry) => entry.name)).toEqual(['Export/Eve/Postagens 0123456789abcdef0123456789abcdef.csv']);
  });

  it('rejects a file that is not a zip', () => {
    expect(() => readZipEntries(text('definitely not a zip file at all'))).toThrow(ZipError);
  });
});

describe('extractCsvFiles', () => {
  it('finds CSVs at any depth, including inside nested zips, and skips macOS clutter', async () => {
    const inner = makeZip([{ name: 'Deep 0123456789abcdef0123456789abcdef.csv', data: text('a,b\n1,2'), deflate: true }]);
    const outer = makeZip([
      { name: 'Export/Social Media 1352754f44e8804395bcf69a5c7d834a.csv', data: text('Cliente\nX'), deflate: true },
      { name: 'Export/Social Media 1352754f44e8804395bcf69a5c7d834a_all.csv', data: text('Cliente\nX\nY') },
      { name: 'Export/page.md', data: text('# not a csv') },
      { name: '__MACOSX/Export/._junk.csv', data: text('junk') },
      { name: 'Export-Part-1.zip', data: inner },
    ]);

    const files = await extractCsvFiles(outer);
    expect(files.map((file) => file.path).sort()).toEqual([
      'Export-Part-1.zip/Deep 0123456789abcdef0123456789abcdef.csv',
      'Export/Social Media 1352754f44e8804395bcf69a5c7d834a.csv',
      'Export/Social Media 1352754f44e8804395bcf69a5c7d834a_all.csv',
    ]);
    const deep = files.find((file) => file.path.includes('Deep'))!;
    expect(new TextDecoder().decode(deep.bytes)).toBe('a,b\n1,2');
  });
});
