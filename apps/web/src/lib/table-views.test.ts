import { describe, expect, it } from 'vitest';
import type { DataColumn, DataTableRowValue } from '../components/data-table-types';
import { bucketByDay, coverImage, initialMonth, rowTitle, titleColumn } from './table-views';

const COLUMNS: DataColumn[] = [
  { key: 'cliente', label: 'Cliente', type: 'client' },
  { key: 'titulo', label: 'Título', type: 'text' },
  { key: 'quando', label: 'Data', type: 'date' },
  { key: 'capa', label: 'Capa', type: 'url' },
];

const row = (id: string, data: Record<string, unknown>): DataTableRowValue => ({ id, tableId: 't', data });
const TODAY = new Date(2026, 8, 21);

describe('row titles', () => {
  it('uses the first text column, skipping a leading relation', () => {
    expect(titleColumn(COLUMNS)?.key).toBe('titulo');
    expect(rowTitle(COLUMNS, row('1', { titulo: 'Reels Dr. Uniforme\nsegunda linha' }), {})).toBe('Reels Dr. Uniforme');
  });

  it('falls back to the client, then to a placeholder', () => {
    expect(rowTitle(COLUMNS, row('1', { cliente: 'c1' }), { c1: '4s Estamparia' })).toBe('4s Estamparia');
    expect(rowTitle(COLUMNS, row('1', {}), {})).toBe('Sem título');
  });

  it('names rows of a table with no text column by its first non-checkbox column', () => {
    const columns: DataColumn[] = [
      { key: 'ok', label: 'Ok', type: 'boolean' },
      { key: 'status', label: 'Status', type: 'select' },
    ];
    expect(rowTitle(columns, row('1', { status: 'Ativa' }), {})).toBe('Ativa');
  });
});

describe('calendar buckets', () => {
  const rows = [
    row('1', { quando: '31/08/2026' }),
    row('2', { quando: '2026-09-04' }),
    row('3', { quando: '4 de setembro de 2026' }),
    row('4', { quando: 'não vamos' }),
    row('5', {}),
    row('6', { quando: '11/09' }),
  ];

  it('places rows on their day whatever format the date was written in', () => {
    const { byDay, undated } = bucketByDay(rows, 'quando', TODAY);
    expect(byDay.get('2026-08-31')!.map((item) => item.id)).toEqual(['1']);
    expect(byDay.get('2026-09-04')!.map((item) => item.id)).toEqual(['2', '3']);
    expect(byDay.get('2026-09-11')!.map((item) => item.id)).toEqual(['6']);
  });

  it('collects rows the calendar cannot place under "sem data"', () => {
    expect(bucketByDay(rows, 'quando', TODAY).undated.map((item) => item.id)).toEqual(['4', '5']);
  });

  it('opens on the current month if it has rows, else on the nearest dated month', () => {
    expect(initialMonth(rows, 'quando', TODAY)).toEqual({ year: 2026, month: 8 });
    expect(initialMonth([row('1', { quando: '10/01/2026' }), row('2', { quando: '10/07/2026' })], 'quando', TODAY)).toEqual({ year: 2026, month: 6 });
    expect(initialMonth([], 'quando', TODAY)).toEqual({ year: 2026, month: 8 });
  });
});

describe('gallery covers', () => {
  it('uses a link cell that points at an image', () => {
    expect(coverImage(COLUMNS, row('1', { capa: 'https://cdn.example.com/a.PNG?x=1' }))).toBe('https://cdn.example.com/a.PNG?x=1');
    expect(coverImage(COLUMNS, row('1', { capa: '/uploads/post-media/a' }))).toBe('/uploads/post-media/a');
  });

  it('ignores links that are not pictures', () => {
    expect(coverImage(COLUMNS, row('1', { capa: 'https://www.instagram.com/p/abc' }))).toBeNull();
    expect(coverImage(COLUMNS, row('1', {}))).toBeNull();
  });
});
