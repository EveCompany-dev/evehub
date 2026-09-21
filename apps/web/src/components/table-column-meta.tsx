import { CalendarDays, CircleChevronDown, Contact, Hash, Link2, List, SquareCheck, Type } from '@eve/ui';
import type { JSX } from 'react';
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

const COLUMN_TYPE_ICON = {
  text: Type,
  number: Hash,
  boolean: SquareCheck,
  date: CalendarDays,
  select: CircleChevronDown,
  multiselect: List,
  url: Link2,
  client: Contact,
} as const;

/** The little glyph in front of a column's name — the same set Notion uses for property types. */
export function ColumnTypeIcon({ type, size = 14 }: { type: DataColumnType; size?: number }): JSX.Element {
  const Icon = COLUMN_TYPE_ICON[type];
  return <Icon size={size} aria-hidden="true" />;
}
