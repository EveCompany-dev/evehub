import type { FieldSchema, FieldType, RemoteRecord } from './types';

const MAX_AUTO_FIELDS = 6;

function detectType(value: unknown): FieldType {
  if (typeof value === 'boolean') return 'boolean';
  if (typeof value === 'number') return 'number';
  if (typeof value === 'string' && !Number.isNaN(Date.parse(value)) && /^\d{4}-\d{2}-\d{2}/.test(value)) return 'date';
  return 'text';
}

function toLabel(key: string): string {
  return key
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

/**
 * Fallback field schema for connectors that don't implement `describeFields`:
 * infers columns and types from the shape of the first synced record. Keeps
 * every field writable=false — a connector opting into edit support should
 * declare `describeFields` explicitly rather than rely on a guess.
 */
export function autoDetectFields(records: RemoteRecord[]): FieldSchema[] {
  const first = records[0];
  if (!first) return [];

  return Object.entries(first.data)
    .slice(0, MAX_AUTO_FIELDS)
    .map(([key, value]) => ({
      key,
      label: toLabel(key),
      type: detectType(value),
      writable: false,
    }));
}
