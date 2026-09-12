'use client';

import { strings, WidgetShell } from '@eve/ui';
import { useState, type JSX } from 'react';
import { MonthGrid } from '../components/MonthGrid';
import type { WidgetProps } from './types';

/** No data, no events — just the month grid, for layout/testing purposes. */
export function CalendarWidget({ title, onRemove }: WidgetProps): JSX.Element {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth());

  return (
    <WidgetShell
      title={title}
      status="ok"
      actions={[{ label: strings.dashboard.removeWidget, onSelect: onRemove, danger: true }]}
    >
      <div className="eve-no-drag">
        <MonthGrid
          year={year}
          month={month}
          onMonthChange={(nextYear, nextMonth) => {
            setYear(nextYear);
            setMonth(nextMonth);
          }}
        />
      </div>
    </WidgetShell>
  );
}
