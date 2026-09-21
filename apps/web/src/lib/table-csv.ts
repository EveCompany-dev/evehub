import type { DataColumn, DataTableRowValue } from '../components/data-table-types';
import { displayDate } from './table-dates';

/** Wraps a field in quotes (doubling any internal quotes) only when it needs it — commas, quotes, or newlines. */
export function csvField(value: unknown): string {
  const text = value === null || value === undefined ? '' : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/**
 * Table -> CSV, in the shape the importer reads back: tags as "Reels, Feed"
 * (what Notion writes), dates as shown in the grid, clients by name.
 */
export function toCsv(columns: DataColumn[], rows: DataTableRowValue[], clientLabels: Record<string, string> = {}): string {
  const header = columns.map((column) => csvField(column.label)).join(',');
  const lines = rows.map((row) =>
    columns
      .map((column) => {
        const raw = row.data[column.key];
        // A 'client' column stores a client id — export the human name
        // instead, otherwise every row is just a column of opaque cuids.
        const value =
          column.type === 'client' && typeof raw === 'string'
            ? (clientLabels[raw] ?? raw)
            : Array.isArray(raw)
              ? raw.join(', ')
              : column.type === 'date' && typeof raw === 'string'
                ? displayDate(raw)
                : column.type === 'boolean' && typeof raw === 'boolean'
                  ? raw
                    ? 'Yes'
                    : 'No'
                  : raw;
        return csvField(value);
      })
      .join(','),
  );
  // Leading BOM: Excel otherwise mis-detects the encoding for accented pt-BR text.
  return ['﻿' + header, ...lines].join('\n');
}
