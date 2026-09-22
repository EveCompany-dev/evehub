'use client';

import { useMemo, useState, type JSX } from 'react';
import { normalizeName } from '../lib/table-import/clients';
import { toIsoDate } from '../lib/table-dates';
import { bucketByDay, initialMonth, rowTitle } from '../lib/table-views';
import type { DataColumn, DataTableRowValue, TableEnv } from './data-table-types';
import { MonthGrid } from './MonthGrid';
import { FacebookIcon, InstagramIcon } from './PlatformIcon';
import { Popover } from './Popover';
import { ClientPill, TagPill } from './TagPill';

export interface CalendarViewProps {
  env: TableEnv;
  rows: DataTableRowValue[];
  dateColumn: DataColumn;
  clientLabels: Record<string, string>;
  /** Draw the client on each entry (the all-clients calendar needs it; a client's own page doesn't). */
  showClient: boolean;
  onOpen: (rowId: string) => void;
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
 * written; entries with no readable date wait under "Sem data" instead of
 * disappearing. Nothing is filtered here: what you see is everything scheduled.
 * It only shows what is already planned — new entries are added from the
 * table (Tabelas, or Postagens on the client page), not from here.
 */
export function CalendarView({ env, rows, dateColumn, clientLabels, showClient, onOpen }: CalendarViewProps): JSX.Element {
  const columns = env.table.columns;
  const buckets = useMemo(() => bucketByDay(rows, dateColumn.key), [rows, dateColumn.key]);
  const start = useMemo(() => initialMonth(rows, dateColumn.key), [rows, dateColumn.key]);
  const [cursor, setCursor] = useState(start);
  const [undatedAnchor, setUndatedAnchor] = useState<DOMRect | null>(null);

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
      <div className="eve-calview__bar">
        <button type="button" className="eve-calview__undated" onClick={(event) => setUndatedAnchor(event.currentTarget.getBoundingClientRect())} disabled={buckets.undated.length === 0}>
          Sem data ({buckets.undated.length})
        </button>
      </div>

      <MonthGrid
        year={cursor.year}
        month={cursor.month}
        onMonthChange={(year, month) => setCursor({ year, month })}
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

      {undatedAnchor && (
        <Popover anchor={undatedAnchor} onClose={() => setUndatedAnchor(null)} width={320}>
          <p className="eve-popover__title">Sem data reconhecível</p>
          <div className="eve-popover__list">
            {buckets.undated.map((row) => (
              <button
                key={row.id}
                type="button"
                className="eve-popover__item"
                onClick={() => {
                  setUndatedAnchor(null);
                  onOpen(row.id);
                }}
              >
                {rowTitle(columns, row, clientLabels)}
                {typeof row.data[dateColumn.key] === 'string' && row.data[dateColumn.key] !== '' && (
                  <span className="eve-dim eve-popover__count">“{String(row.data[dateColumn.key])}”</span>
                )}
              </button>
            ))}
          </div>
        </Popover>
      )}
    </div>
  );
}
