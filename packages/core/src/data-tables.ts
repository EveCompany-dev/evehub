import { z } from 'zod';

/**
 * `select` is one tag (a status, say), `multiselect` is any number of them —
 * both render as colored pills and both double as row filters in the UI.
 * `image` holds a picture (an uploaded file's path or an image link) and is
 * what gallery cards use as their cover. `client` is a relation to a workspace
 * client (stored as its id).
 */
export const dataColumnTypeSchema = z.enum(['text', 'number', 'boolean', 'date', 'select', 'multiselect', 'url', 'image', 'client']);

export type DataColumnType = z.infer<typeof dataColumnTypeSchema>;

/**
 * One column of a local (non-connector) data table. `key` is the stable
 * identifier used in every row's `data` — it is set once at creation and
 * never exposed as editable in the UI, so relabeling a column never orphans
 * existing row data the way a key rename would.
 *
 * `optionColors` maps an option to a palette key (see apps/web lib/table-tags);
 * options without an entry get a stable color derived from their name, so
 * legacy `select` columns (options only) keep working unchanged.
 */
export const dataColumnSchema = z.object({
  key: z.string().min(1).max(60),
  label: z.string().min(1).max(120),
  type: dataColumnTypeSchema,
  options: z.array(z.string()).optional(),
  optionColors: z.record(z.string(), z.string().max(20)).optional(),
});

export const dataColumnsSchema = z.array(dataColumnSchema).min(1);

export type DataColumn = z.infer<typeof dataColumnSchema>;

/** Splits a free-text tag list ("Reels, Feed") into trimmed, de-duplicated values. */
export function splitTagList(value: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of value.split(/[,;\n]/)) {
    const tag = part.trim();
    if (!tag || seen.has(tag)) continue;
    seen.add(tag);
    out.push(tag);
  }
  return out;
}

/** Coerces an arbitrary JSON value (e.g. from a webhook payload) to a column's declared type. */
export function coerceColumnValue(value: unknown, type: DataColumn['type']): unknown {
  if (value === null || value === undefined) return null;

  switch (type) {
    case 'number': {
      const num = typeof value === 'number' ? value : Number(value);
      return Number.isFinite(num) ? num : null;
    }
    case 'boolean':
      if (typeof value === 'boolean') return value;
      if (typeof value === 'string') return value.toLowerCase() === 'true' || value === '1';
      return Boolean(value);
    case 'multiselect': {
      if (Array.isArray(value)) return splitTagList(value.map((item) => String(item)).join(','));
      return splitTagList(String(value));
    }
    case 'text':
    case 'date':
    case 'select':
    case 'url':
    case 'image':
    case 'client':
    default:
      return String(value);
  }
}

/** Generates a stable column key from its label, disambiguated against existing keys. */
export function slugifyColumnKey(label: string, existing: string[]): string {
  const base =
    label
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '') // strip combining diacritics (á -> a, ç -> c, ...)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 54) || 'campo';

  if (!existing.includes(base)) return base;

  let suffix = 2;
  while (existing.includes(`${base}_${suffix}`)) suffix += 1;
  return `${base}_${suffix}`;
}
