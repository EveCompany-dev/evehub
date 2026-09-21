import type { DataColumnType } from './data-table-types';

export const COLUMN_TYPE_LABEL: Record<DataColumnType, string> = {
  text: 'Texto',
  number: 'Número',
  boolean: 'Sim/Não',
  date: 'Data',
  select: 'Seleção (status)',
  multiselect: 'Tags (várias)',
  url: 'Link',
  client: 'Cliente',
};

export const COLUMN_TYPE_ICON: Record<DataColumnType, string> = {
  text: 'Aa',
  number: '#',
  boolean: '☑',
  date: '📅',
  select: '◉',
  multiselect: '≡',
  url: '🔗',
  client: '👤',
};
