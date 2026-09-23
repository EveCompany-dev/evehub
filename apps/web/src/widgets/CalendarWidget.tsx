'use client';

import { WidgetShell } from '@eve/ui';
import { useState, type JSX } from 'react';
import { MonthGrid } from '../components/MonthGrid';
import type { WidgetProps } from './types';

/** No data, no events — just the month grid, for layout/testing purposes. */
export function CalendarWidget({ title }: WidgetProps): JSX.Element {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth());

  return (
    // No options of its own: the settings card (⋮) shows only lock and remove.
    <WidgetShell title={title} status="ok">
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
