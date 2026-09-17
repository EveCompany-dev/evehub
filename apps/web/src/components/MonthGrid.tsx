'use client';

import type { JSX, ReactNode } from 'react';

const WEEKDAYS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

function daysInMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate();
}

function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

interface Cell {
  date: Date;
  /** Leading/trailing day from the previous/next month, shown muted and clickable to navigate there. */
  adjacent: boolean;
}

export interface MonthGridProps {
  /** Controlled month cursor — the caller owns the state so it can react to navigation (e.g. refetch). */
  year: number;
  month: number;
  onMonthChange: (year: number, month: number) => void;
  renderDay?: (date: Date) => ReactNode;
  onDayClick?: (date: Date) => void;
}

/**
 * Presentational month grid: date math, "today" highlight, month nav. No data
 * of its own — used both by the scheduling calendar (real posts) and the
 * plain calendar widget (nothing, just dates).
 */
export function MonthGrid({ year, month, onMonthChange, renderDay, onDayClick }: MonthGridProps): JSX.Element {
  const today = new Date();
  const firstWeekday = new Date(year, month, 1).getDay();
  const total = daysInMonth(year, month);

  const prevMonthTotal = daysInMonth(year, month === 0 ? 11 : month - 1);
  const trailingCount = (7 - ((firstWeekday + total) % 7)) % 7;

  const cells: Cell[] = [
    ...Array.from({ length: firstWeekday }, (_, index) => {
      const prevYear = month === 0 ? year - 1 : year;
      const prevMonth = month === 0 ? 11 : month - 1;
      return { date: new Date(prevYear, prevMonth, prevMonthTotal - firstWeekday + index + 1), adjacent: true };
    }),
    ...Array.from({ length: total }, (_, index) => ({ date: new Date(year, month, index + 1), adjacent: false })),
    ...Array.from({ length: trailingCount }, (_, index) => {
      const nextYear = month === 11 ? year + 1 : year;
      const nextMonth = month === 11 ? 0 : month + 1;
      return { date: new Date(nextYear, nextMonth, index + 1), adjacent: true };
    }),
  ];

  const monthLabel = new Date(year, month, 1).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });

  const goToPrevious = () => (month === 0 ? onMonthChange(year - 1, 11) : onMonthChange(year, month - 1));
  const goToNext = () => (month === 11 ? onMonthChange(year + 1, 0) : onMonthChange(year, month + 1));

  return (
    <div className="eve-month">
      <div className="eve-month__head eve-no-drag">
        <button type="button" className="eve-btn eve-btn--icon" onClick={goToPrevious} aria-label="Mes anterior">
          ‹
        </button>
        <strong className="eve-month__label">{monthLabel}</strong>
        <button type="button" className="eve-btn eve-btn--icon" onClick={goToNext} aria-label="Proximo mes">
          ›
        </button>
      </div>

      <div className="eve-month__weekdays">
        {WEEKDAYS.map((day) => (
          <span key={day}>{day}</span>
        ))}
      </div>

      <div className="eve-month__grid">
        {cells.map(({ date, adjacent }, index) => {
          const isToday = !adjacent && sameDay(date, today);
          const classes = ['eve-month__day'];
          if (isToday) classes.push('is-today');
          if (adjacent) classes.push('is-adjacent');
          return (
            <div
              key={index}
              className={classes.join(' ')}
              onClick={adjacent ? () => onMonthChange(date.getFullYear(), date.getMonth()) : onDayClick ? () => onDayClick(date) : undefined}
            >
              <span className="eve-month__num">{date.getDate()}</span>
              {!adjacent && renderDay?.(date)}
            </div>
          );
        })}
      </div>
    </div>
  );
}
