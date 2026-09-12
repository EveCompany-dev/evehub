'use client';

import type { JSX, ReactNode } from 'react';

const WEEKDAYS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

function daysInMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate();
}

function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
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

  const cells: (Date | null)[] = [
    ...Array.from({ length: firstWeekday }, () => null),
    ...Array.from({ length: total }, (_, index) => new Date(year, month, index + 1)),
  ];
  while (cells.length % 7 !== 0) cells.push(null);

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
        {cells.map((date, index) => {
          if (!date) return <div key={index} className="eve-month__day is-empty" />;
          const isToday = sameDay(date, today);
          return (
            <div
              key={index}
              className={isToday ? 'eve-month__day is-today' : 'eve-month__day'}
              onClick={onDayClick ? () => onDayClick(date) : undefined}
            >
              <span className="eve-month__num">{date.getDate()}</span>
              {renderDay?.(date)}
            </div>
          );
        })}
      </div>
    </div>
  );
}
