import { describe, expect, it } from 'vitest';
import type { DataColumn, DataTableRowValue } from '../components/data-table-types';
import {
  activeFilterCount,
  cellTokens,
  columnFacets,
  EMPTY_FILTERS,
  EMPTY_TOKEN,
  filterRows,
  withColumnFilter,
} from './table-filters';

const COLUMNS: DataColumn[] = [
  { key: 'titulo', label: 'Título', type: 'text' },
  { key: 'status', label: 'Status', type: 'select', options: ['Ideia', 'Publicado', 'Cancelado'] },
  { key: 'tags', label: 'Tags', type: 'multiselect', options: ['Reels', 'Feed', 'Institucional'] },
  { key: 'cliente', label: 'Cliente', type: 'client' },
  { key: 'aprovado', label: 'Aprovado', type: 'boolean' },
  { key: 'quando', label: 'Data', type: 'date' },
];

const row = (id: string, data: Record<string, unknown>): DataTableRowValue => ({ id, tableId: 't', data });

const ROWS = [
  row('1', { titulo: 'Carrossel Quantos Uniformes', status: 'Publicado', tags: ['Reels', 'Feed'], cliente: 'c1', aprovado: true, quando: '2026-08-31' }),
  row('2', { titulo: 'Reels Dr. Uniforme', status: 'Ideia', tags: ['Reels'], cliente: 'c1' }),
  row('3', { titulo: 'Post Família', status: 'Publicado', tags: ['Feed', 'Institucional'], cliente: 'c2', aprovado: true }),
  row('4', { titulo: 'Sem nada' }),
];

const LABELS = { c1: '4s Estamparia', c2: 'Marcotex' };

const ids = (rows: DataTableRowValue[]) => rows.map((item) => item.id);

describe('filtering by tag', () => {
  it('matches a single select, and any-of across several values', () => {
    const one = withColumnFilter(EMPTY_FILTERS, { key: 'status', values: ['Ideia'] }, 'status');
    expect(ids(filterRows(ROWS, COLUMNS, one, LABELS))).toEqual(['2']);
    const two = withColumnFilter(EMPTY_FILTERS, { key: 'status', values: ['Ideia', 'Cancelado'] }, 'status');
    expect(ids(filterRows(ROWS, COLUMNS, two, LABELS))).toEqual(['2']);
  });

  it('matches a multiselect when the cell holds any of the picked tags', () => {
    const state = withColumnFilter(EMPTY_FILTERS, { key: 'tags', values: ['Institucional'] }, 'tags');
    expect(ids(filterRows(ROWS, COLUMNS, state, LABELS))).toEqual(['3']);
    const reels = withColumnFilter(EMPTY_FILTERS, { key: 'tags', values: ['Reels'] }, 'tags');
    expect(ids(filterRows(ROWS, COLUMNS, reels, LABELS))).toEqual(['1', '2']);
  });

  it('ANDs different columns together', () => {
    let state = withColumnFilter(EMPTY_FILTERS, { key: 'tags', values: ['Feed'] }, 'tags');
    state = withColumnFilter(state, { key: 'status', values: ['Publicado'] }, 'status');
    state = withColumnFilter(state, { key: 'cliente', values: ['c2'] }, 'cliente');
    expect(ids(filterRows(ROWS, COLUMNS, state, LABELS))).toEqual(['3']);
  });

  it('finds blanks through the empty token', () => {
    const state = withColumnFilter(EMPTY_FILTERS, { key: 'status', values: [EMPTY_TOKEN] }, 'status');
    expect(ids(filterRows(ROWS, COLUMNS, state, LABELS))).toEqual(['4']);
  });

  it('treats an unticked checkbox as "No", not blank', () => {
    const no = withColumnFilter(EMPTY_FILTERS, { key: 'aprovado', values: ['false'] }, 'aprovado');
    expect(ids(filterRows(ROWS, COLUMNS, no, LABELS))).toEqual(['2', '4']);
    expect(cellTokens(COLUMNS[4]!, undefined)).toEqual(['false']);
  });

  it('filters relations by client and by client name in search', () => {
    const state = withColumnFilter(EMPTY_FILTERS, { key: 'cliente', values: ['c1'] }, 'cliente');
    expect(ids(filterRows(ROWS, COLUMNS, state, LABELS))).toEqual(['1', '2']);
    expect(ids(filterRows(ROWS, COLUMNS, { search: 'marcotex', filters: [] }, LABELS))).toEqual(['3']);
  });
});

describe('search and text filters', () => {
  it('searches every column, ignoring case and accents', () => {
    expect(ids(filterRows(ROWS, COLUMNS, { search: 'familia', filters: [] }, LABELS))).toEqual(['3']);
    expect(ids(filterRows(ROWS, COLUMNS, { search: 'INSTITUCIONAL', filters: [] }, LABELS))).toEqual(['3']);
    expect(ids(filterRows(ROWS, COLUMNS, { search: '31/08/2026', filters: [] }, LABELS))).toEqual(['1']);
  });

  it('supports a per-column text filter', () => {
    const state = withColumnFilter(EMPTY_FILTERS, { key: 'titulo', text: 'uniforme' }, 'titulo');
    expect(ids(filterRows(ROWS, COLUMNS, state, LABELS))).toEqual(['1', '2']);
  });

  it('returns the same array when nothing is filtered', () => {
    expect(filterRows(ROWS, COLUMNS, EMPTY_FILTERS, LABELS)).toBe(ROWS);
  });
});

describe('filter state', () => {
  it('replaces a column filter in place and removes it when emptied', () => {
    let state = withColumnFilter(EMPTY_FILTERS, { key: 'status', values: ['Ideia'] }, 'status');
    state = withColumnFilter(state, { key: 'tags', values: ['Feed'] }, 'tags');
    state = withColumnFilter(state, { key: 'status', values: ['Publicado'] }, 'status');
    expect(state.filters.map((filter) => filter.key)).toEqual(['status', 'tags']);
    expect(state.filters[0]!.values).toEqual(['Publicado']);
    state = withColumnFilter(state, { key: 'status', values: [] }, 'status');
    expect(state.filters.map((filter) => filter.key)).toEqual(['tags']);
    expect(activeFilterCount({ search: 'x', filters: state.filters })).toBe(2);
  });
});

describe('facets', () => {
  it('lists declared options with counts (including unused ones) and the empty bucket last', () => {
    const facets = columnFacets(COLUMNS[1]!, ROWS, LABELS);
    expect(facets).toEqual([
      { token: 'Ideia', label: 'Ideia', count: 1 },
      { token: 'Publicado', label: 'Publicado', count: 2 },
      { token: 'Cancelado', label: 'Cancelado', count: 0 },
      { token: EMPTY_TOKEN, label: 'Vazio', count: 1 },
    ]);
  });

  it('counts every tag of a multiselect and names clients', () => {
    const tags = columnFacets(COLUMNS[2]!, ROWS, LABELS);
    expect(tags.find((facet) => facet.token === 'Reels')!.count).toBe(2);
    expect(tags.find((facet) => facet.token === 'Feed')!.count).toBe(2);
    const clients = columnFacets(COLUMNS[3]!, ROWS, LABELS);
    expect(clients.map((facet) => [facet.label, facet.count])).toEqual([
      ['4s Estamparia', 2],
      ['Marcotex', 1],
      ['Vazio', 1],
    ]);
  });

  it('surfaces a value that exists in the data but was never declared as an option', () => {
    const extra = [row('9', { status: 'Em análise' })];
    expect(columnFacets(COLUMNS[1]!, extra, LABELS).map((facet) => facet.token)).toContain('Em análise');
  });
});
