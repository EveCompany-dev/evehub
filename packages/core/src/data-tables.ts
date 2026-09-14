import { z } from 'zod';

/**
 * One column of a local (non-connector) data table. `key` is the stable
 * identifier used in every row's `data` — it is set once at creation and
 * never exposed as editable in the UI, so relabeling a column never orphans
 * existing row data the way a key rename would.
 */
export const dataColumnSchema = z.object({
  key: z.string().min(1).max(60),
  label: z.string().min(1).max(120),
  type: z.enum(['text', 'number', 'boolean', 'date', 'select', 'client']),
  options: z.array(z.string()).optional(),
});

export const dataColumnsSchema = z.array(dataColumnSchema).min(1);

export type DataColumn = z.infer<typeof dataColumnSchema>;

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
    case 'text':
    case 'date':
    case 'select':
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
      .replace(/^_+|_+$/g, '') || 'campo';

  if (!existing.includes(base)) return base;

  let suffix = 2;
  while (existing.includes(`${base}_${suffix}`)) suffix += 1;
  return `${base}_${suffix}`;
}
