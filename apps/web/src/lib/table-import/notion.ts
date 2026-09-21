/**
 * Notion writes each database twice: "Name <id>.csv" holds what the saved
 * view shows (its visible columns and filtered rows) and "Name <id>_all.csv"
 * holds every property and every row. Both are valid imports, so the wizard
 * groups them and lets the user pick — a single loose file just imports as-is.
 */

export type NotionVariant = 'visible' | 'all';

export interface CsvSource {
  /** Path inside the zip, or the bare file name for a loose upload. */
  path: string;
  bytes: Uint8Array;
}

export interface NotionFileName {
  /** Human title: "Social Media Clientes". */
  title: string;
  variant: NotionVariant;
  /** Stable grouping key — same folder and database, either variant. */
  groupKey: string;
}

// Separates the folder from the name inside a grouping key. A path can't contain a newline.
const KEY_SEPARATOR = '\n';

/** Splits "Social Media Clientes 1352754f44e8804395bcf69a5c7d834a_all.csv" into title + variant. */
export function parseNotionFileName(path: string): NotionFileName {
  const segments = path.split('/');
  const file = segments[segments.length - 1] ?? path;
  const folder = segments.slice(0, -1).join('/');

  let base = file.replace(/\.csv$/i, '');
  let variant: NotionVariant = 'visible';
  if (/_all$/i.test(base)) {
    variant = 'all';
    base = base.replace(/_all$/i, '');
  }
  // Notion appends a 32-hex page id; Notion-agnostic files simply don't have one.
  const title = base.replace(/\s+[0-9a-f]{32}$/i, '').trim() || base;
  return { title, variant, groupKey: `${folder}${KEY_SEPARATOR}${base.toLowerCase()}` };
}

export interface NotionDataset {
  key: string;
  title: string;
  visible?: CsvSource;
  all?: CsvSource;
}

/** Groups loose or zipped CSVs into datasets, pairing each database's visible and _all files. */
export function groupNotionCsvs(files: CsvSource[]): NotionDataset[] {
  const groups = new Map<string, NotionDataset>();
  for (const file of files) {
    const parsed = parseNotionFileName(file.path);
    const dataset = groups.get(parsed.groupKey) ?? { key: parsed.groupKey, title: parsed.title };
    // A duplicate of the same variant (same name twice) stays a separate dataset.
    if (dataset[parsed.variant]) {
      const key = `${parsed.groupKey}${KEY_SEPARATOR}${groups.size}`;
      groups.set(key, { key, title: parsed.title, [parsed.variant]: file });
      continue;
    }
    dataset[parsed.variant] = file;
    groups.set(parsed.groupKey, dataset);
  }
  return [...groups.values()].sort((a, b) => a.title.localeCompare(b.title, 'pt-BR'));
}
