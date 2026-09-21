'use client';

import { useMemo, useState, type JSX } from 'react';
import { toIsoDate } from '../lib/table-dates';
import { bucketByDay, initialMonth, rowTitle } from '../lib/table-views';
import type { DataColumn, DataTableRowValue, TableEnv } from './data-table-types';
import { MonthGrid } from './MonthGrid';
import { Popover } from './Popover';
import { TagPills } from './TagPill';

export interface CalendarViewProps {
  env: TableEnv;
  rows: DataTableRowValue[];
  dateColumn: DataColumn;
  clientLabels: Record<string, string>;
  onOpen: (rowId: string) => void;
  /** Creates a row already dated to this day. */
  onAddOnDay: (date: Date) => void;
}

/**
 * The content schedule: every row on its day, whichever way the date was
 * written. Chips carry the title and the row's colored tags so a month reads
 * at a glance; rows with no readable date wait under "Sem data" instead of
 * disappearing.
 */
export function CalendarView({ env, rows, dateColumn, clientLabels, onOpen, onAddOnDay }: CalendarViewProps): JSX.Element {
  const columns = env.table.columns;
  const buckets = useMemo(() => bucketByDay(rows, dateColumn.key), [rows, dateColumn.key]);
  const start = useMemo(() => initialMonth(rows, dateColumn.key), [rows, dateColumn.key]);
  const [cursor, setCursor] = useState(start);
  const [undatedAnchor, setUndatedAnchor] = useState<DOMRect | null>(null);

  // The tag columns worth drawing on a chip: status first, then tags. Two at most, or chips overflow the day cell.
  const tagColumns = useMemo(
    () =>
      [...columns.filter((column) => column.type === 'select'), ...columns.filter((column) => column.type === 'multiselect')].slice(0, 2),
    [columns],
  );

  return (
    <div className="eve-calview">
      <div className="eve-calview__bar">
        <button type="button" className="eve-btn" onClick={() => setCursor(initialMonth([], dateColumn.key))}>
          Hoje
        </button>
        <button type="button" className="eve-btn" onClick={(event) => setUndatedAnchor(event.currentTarget.getBoundingClientRect())} disabled={buckets.undated.length === 0}>
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
              {dayRows.map((row) => (
                <button
                  key={row.id}
                  type="button"
                  className="eve-calview__chip"
                  onClick={(event) => {
                    event.stopPropagation();
                    onOpen(row.id);
                  }}
                >
                  <span className="eve-calview__title">{rowTitle(columns, row, clientLabels)}</span>
                  {tagColumns.map((column) => (
                    <TagPills key={column.key} column={column} value={row.data[column.key]} />
                  ))}
                </button>
              ))}
              <button
                type="button"
                className="eve-calview__add"
                aria-label={`Nova linha em ${date.toLocaleDateString('pt-BR')}`}
                onClick={(event) => {
                  event.stopPropagation();
                  onAddOnDay(date);
                }}
              >
                +
              </button>
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
