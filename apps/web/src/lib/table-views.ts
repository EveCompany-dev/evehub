import type { DataColumn, DataTableRowValue } from '../components/data-table-types';
import { parseLooseDate, sameCalendarDay, toIsoDate } from './table-dates';

/** The column that names a row: the first text column, else the first one that isn't a checkbox. */
export function titleColumn(columns: DataColumn[]): DataColumn | null {
  return columns.find((column) => column.type === 'text') ?? columns.find((column) => column.type !== 'boolean') ?? columns[0] ?? null;
}

/** A row's display name — its title cell, or the client it belongs to, or a placeholder. */
export function rowTitle(columns: DataColumn[], row: DataTableRowValue, clientLabels: Record<string, string>): string {
  const column = titleColumn(columns);
  if (!column) return 'Sem título';
  const value = row.data[column.key];
  if (value === null || value === undefined || value === '') {
    // A table keyed by a client relation ("Cliente") has no text title — the client is the title.
    const client = columns.find((item) => item.type === 'client');
    const id = client ? row.data[client.key] : null;
    return (typeof id === 'string' && clientLabels[id]) || 'Sem título';
  }
  if (column.type === 'client') return clientLabels[String(value)] ?? 'Sem título';
  const text = Array.isArray(value) ? value.join(', ') : String(value);
  return text.split('\n')[0]!.trim() || 'Sem título';
}

export function dateColumns(columns: DataColumn[]): DataColumn[] {
  return columns.filter((column) => column.type === 'date');
}

export function rowDate(row: DataTableRowValue, columnKey: string, ref: Date = new Date()): Date | null {
  const value = row.data[columnKey];
  return typeof value === 'string' ? parseLooseDate(value, ref) : null;
}

export interface DayBuckets {
  byDay: Map<string, DataTableRowValue[]>;
  /** Rows with no date, or one the calendar can't read ("não vamos", "-"). */
  undated: DataTableRowValue[];
}

export function bucketByDay(rows: DataTableRowValue[], columnKey: string, ref: Date = new Date()): DayBuckets {
  const byDay = new Map<string, DataTableRowValue[]>();
  const undated: DataTableRowValue[] = [];
  for (const row of rows) {
    const date = rowDate(row, columnKey, ref);
    if (!date) {
      undated.push(row);
      continue;
    }
    const key = toIsoDate(date);
    const list = byDay.get(key);
    if (list) list.push(row);
    else byDay.set(key, [row]);
  }
  return { byDay, undated };
}

/**
 * Which month the calendar opens on: the current one if it has rows,
 * otherwise the month of whichever dated row is closest to today — so a
 * table of last year's posts doesn't open on an empty grid.
 */
export function initialMonth(rows: DataTableRowValue[], columnKey: string, today: Date = new Date()): { year: number; month: number } {
  let best: Date | null = null;
  for (const row of rows) {
    const date = rowDate(row, columnKey, today);
    if (!date) continue;
    if (date.getFullYear() === today.getFullYear() && date.getMonth() === today.getMonth()) return { year: today.getFullYear(), month: today.getMonth() };
    if (!best || Math.abs(date.getTime() - today.getTime()) < Math.abs(best.getTime() - today.getTime())) best = date;
  }
  return best ? { year: best.getFullYear(), month: best.getMonth() } : { year: today.getFullYear(), month: today.getMonth() };
}

export function isToday(date: Date): boolean {
  return sameCalendarDay(date, new Date());
}

const IMAGE_EXTENSION = /\.(png|jpe?g|webp|gif|avif|svg)(\?.*)?$/i;

/** An image to use as a gallery card cover: the first link cell that points at a picture. */
export function coverImage(columns: DataColumn[], row: DataTableRowValue): string | null {
  for (const column of columns) {
    if (column.type !== 'url') continue;
    const value = row.data[column.key];
    if (typeof value === 'string' && (IMAGE_EXTENSION.test(value) || value.startsWith('/uploads/'))) return value;
  }
  return null;
}

export type TableViewMode = 'table' | 'gallery' | 'calendar';

export interface ViewPrefs {
  mode: TableViewMode;
  /** Date column the calendar is keyed by. */
  dateKey?: string;
}
