'use client';

import { useMemo, useState, type JSX } from 'react';
import { normalizeName } from '../lib/table-import/clients';
import { toIsoDate } from '../lib/table-dates';
import { bucketByDay, initialMonth, rowTitle } from '../lib/table-views';
import { useContextMenu, type ContextMenuItem } from './ContextMenu';
import type { DataColumn, DataTableRowValue, TableEnv } from './data-table-types';
import { MonthGrid } from './MonthGrid';
import { FacebookIcon, InstagramIcon } from './PlatformIcon';
import { ClientPill, TagPill } from './TagPill';

/** What was right-clicked: a day, and the entry on it when the click landed on one. */
export interface CalendarMenuTarget {
  date: Date;
  row?: DataTableRowValue;
}

export interface CalendarViewProps {
  env: TableEnv;
  rows: DataTableRowValue[];
  dateColumn: DataColumn;
  clientLabels: Record<string, string>;
  /** Draw the client on each entry (off on a client's own page, where it would only repeat the page). */
  showClient: boolean;
  onOpen: (rowId: string) => void;
  /** Right-click menu for a day or an entry (the client page's "Agendar post"); no menu when omitted. */
  menuFor?: (target: CalendarMenuTarget) => ContextMenuItem[];
}

/** The channel's mark: Instagram/Facebook get their glyph, anything else a neutral dot. */
function ChannelMark({ name }: { name: string }): JSX.Element {
  const key = normalizeName(name);
  if (key === 'instagram') return <InstagramIcon size={14} />;
  if (key === 'facebook') return <FacebookIcon size={14} />;
  return <span className="eve-calview__dot" title={name} aria-hidden="true" />;
}

/**
 * The content schedule, laid out like the Notion "Calendário de Conteúdo":
 * each entry is a white card on its day — channel mark and title, then the
 * format and status pills underneath. Dates are read whichever way they were
 * written. It only shows what is already planned; right-click (when the page
 * offers it) schedules a post from a day or an entry.
 */
export function CalendarView({ env, rows, dateColumn, clientLabels, showClient, onOpen, menuFor }: CalendarViewProps): JSX.Element {
  const columns = env.table.columns;
  const buckets = useMemo(() => bucketByDay(rows, dateColumn.key), [rows, dateColumn.key]);
  const start = useMemo(() => initialMonth(rows, dateColumn.key), [rows, dateColumn.key]);
  const [cursor, setCursor] = useState(start);
  const menu = useContextMenu();

  const channelColumn = columns.find((column) => column.type === 'select' && normalizeName(column.label) === 'canal');
  // Format first, then status — the order Notion shows them — then any other select/tags column.
  const tagColumns = useMemo(() => {
    const selects = columns.filter((column) => (column.type === 'select' || column.type === 'multiselect') && column.key !== channelColumn?.key);
    const rank = (column: DataColumn) => (normalizeName(column.label).startsWith('formato') ? 0 : normalizeName(column.label) === 'status' ? 1 : 2);
    return [...selects].sort((a, b) => rank(a) - rank(b)).slice(0, 2);
  }, [columns, channelColumn?.key]);
  const clientColumn = columns.find((column) => column.type === 'client');

  return (
    <div className="eve-calview">
      <MonthGrid
        year={cursor.year}
        month={cursor.month}
        onMonthChange={(year, month) => setCursor({ year, month })}
        onDayContextMenu={menuFor ? (date, event) => menu.open(event, menuFor({ date })) : undefined}
        renderDay={(date) => {
          const dayRows = buckets.byDay.get(toIsoDate(date)) ?? [];
          return (
            <div className="eve-calview__day">
              {dayRows.map((row) => {
                const channel = channelColumn ? row.data[channelColumn.key] : null;
                const clientId = clientColumn ? row.data[clientColumn.key] : null;
                const client = typeof clientId === 'string' ? env.clientById[clientId] : undefined;
                return (
                  <button
                    key={row.id}
                    type="button"
                    className="eve-calview__chip"
                    onClick={(event) => {
                      event.stopPropagation();
                      onOpen(row.id);
                    }}
                    onContextMenu={
                      menuFor
                        ? (event) => {
                            event.stopPropagation();
                            menu.open(event, menuFor({ date, row }));
                          }
                        : undefined
                    }
                  >
                    <span className="eve-calview__head">
                      {typeof channel === 'string' && channel !== '' && <ChannelMark name={channel} />}
                      <span className="eve-calview__title">{rowTitle(columns, row, clientLabels)}</span>
                    </span>
                    {showClient && client && <ClientPill client={client} />}
                    {tagColumns.map((column) => {
                      const value = row.data[column.key];
                      const names = Array.isArray(value) ? value.map(String) : typeof value === 'string' && value !== '' ? [value] : [];
                      return names.map((name) => <TagPill key={`${column.key}-${name}`} name={name} color={column.optionColors?.[name]} />);
                    })}
                  </button>
                );
              })}
            </div>
          );
        }}
      />
      {menu.render()}
    </div>
  );
}
