import type { DataColumn, DataTableRowValue } from '../components/data-table-types';
import { displayDate } from './table-dates';

/** Filter token for "this cell is empty" — offered next to the real values so blanks can be found too. */
export const EMPTY_TOKEN = '__empty__';

export interface ColumnFilter {
  key: string;
  /** Any-of match over the column's tags/values (select, multiselect, client, boolean). */
  values?: string[];
  /** Case/accent-insensitive substring (text, url, number, date). */
  text?: string;
}

export interface TableFilterState {
  search: string;
  filters: ColumnFilter[];
}

export const EMPTY_FILTERS: TableFilterState = { search: '', filters: [] };

function fold(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
}

/** Columns whose values are a closed set the user can tick off (as opposed to free text). */
export function isFacetColumn(column: DataColumn): boolean {
  return column.type === 'select' || column.type === 'multiselect' || column.type === 'client' || column.type === 'boolean';
}

/** The discrete values a cell holds, as filter tokens. Empty cells yield [EMPTY_TOKEN]. */
export function cellTokens(column: DataColumn, value: unknown): string[] {
  // An unticked checkbox is stored as "nothing" — it still counts as No, not as blank.
  if (column.type === 'boolean') return [value ? 'true' : 'false'];
  if (value === null || value === undefined || value === '' || (Array.isArray(value) && value.length === 0)) return [EMPTY_TOKEN];
  switch (column.type) {
    case 'multiselect':
      return Array.isArray(value) ? value.map(String) : [String(value)];
    default:
      return [String(value)];
  }
}

/** Human text of a cell for search/text filters (client ids become names, ISO dates read as written). */
export function cellText(column: DataColumn, value: unknown, clientLabels: Record<string, string>): string {
  if (value === null || value === undefined || value === '') return '';
  if (Array.isArray(value)) return value.join(', ');
  if (column.type === 'client') return clientLabels[String(value)] ?? '';
  if (column.type === 'boolean') return value ? 'sim' : 'não';
  if (column.type === 'date') return displayDate(String(value));
  return String(value);
}

export function rowMatches(
  row: DataTableRowValue,
  columns: DataColumn[],
  state: TableFilterState,
  clientLabels: Record<string, string>,
): boolean {
  const query = fold(state.search.trim());
  if (query && !columns.some((column) => fold(cellText(column, row.data[column.key], clientLabels)).includes(query))) return false;

  for (const filter of state.filters) {
    const column = columns.find((item) => item.key === filter.key);
    if (!column) continue;
    const value = row.data[filter.key];

    if (filter.values && filter.values.length > 0) {
      const tokens = cellTokens(column, value);
      if (!tokens.some((token) => filter.values!.includes(token))) return false;
    }
    if (filter.text && filter.text.trim()) {
      if (!fold(cellText(column, value, clientLabels)).includes(fold(filter.text.trim()))) return false;
    }
  }
  return true;
}

export function filterRows(
  rows: DataTableRowValue[],
  columns: DataColumn[],
  state: TableFilterState,
  clientLabels: Record<string, string>,
): DataTableRowValue[] {
  if (!state.search.trim() && state.filters.length === 0) return rows;
  return rows.filter((row) => rowMatches(row, columns, state, clientLabels));
}

export interface Facet {
  token: string;
  label: string;
  count: number;
}

/**
 * Every value a facet column holds, with how many rows carry it. Declared
 * options come first (even at 0 rows — they're valid targets), then any
 * value found in the data that isn't declared, then the "empty" bucket.
 */
export function columnFacets(
  column: DataColumn,
  rows: DataTableRowValue[],
  clientLabels: Record<string, string>,
): Facet[] {
  const counts = new Map<string, number>();
  for (const row of rows) {
    for (const token of cellTokens(column, row.data[column.key])) counts.set(token, (counts.get(token) ?? 0) + 1);
  }

  const label = (token: string): string => {
    if (token === EMPTY_TOKEN) return 'Vazio';
    if (column.type === 'client') return clientLabels[token] ?? token;
    if (column.type === 'boolean') return token === 'true' ? 'Sim' : 'Não';
    return token;
  };

  let ordered: string[];
  if (column.type === 'select' || column.type === 'multiselect') {
    const declared = column.options ?? [];
    const extras = [...counts.keys()].filter((token) => token !== EMPTY_TOKEN && !declared.includes(token));
    ordered = [...declared, ...extras];
  } else if (column.type === 'boolean') {
    ordered = ['true', 'false'];
  } else {
    ordered = [...counts.keys()].filter((token) => token !== EMPTY_TOKEN).sort((a, b) => label(a).localeCompare(label(b), 'pt-BR'));
  }
  if (counts.has(EMPTY_TOKEN)) ordered.push(EMPTY_TOKEN);

  return ordered.map((token) => ({ token, label: label(token), count: counts.get(token) ?? 0 }));
}

/** Adds/replaces/removes one column's filter, keeping the others. */
export function withColumnFilter(state: TableFilterState, next: ColumnFilter | null, key: string): TableFilterState {
  const active = next && ((next.values && next.values.length > 0) || (next.text && next.text.trim()));
  const exists = state.filters.some((filter) => filter.key === key);
  if (!active) return { ...state, filters: state.filters.filter((filter) => filter.key !== key) };
  // Editing keeps the chip where it was; a new one goes to the end.
  return { ...state, filters: exists ? state.filters.map((filter) => (filter.key === key ? next : filter)) : [...state.filters, next] };
}

export function activeFilterCount(state: TableFilterState): number {
  return state.filters.length + (state.search.trim() ? 1 : 0);
}
