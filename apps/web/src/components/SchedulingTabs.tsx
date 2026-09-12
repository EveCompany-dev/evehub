'use client';

import { useState, type JSX } from 'react';
import { MonthGrid } from './MonthGrid';
import { SchedulingCalendar } from './SchedulingCalendar';

type View = 'agenda' | 'posts';

/**
 * "Agenda" is a plain calendar — no events yet, that's explicit future work.
 * The Meta post-scheduling calendar (already fully built) lives as a second,
 * separate view on the same page rather than being the thing this tab opens
 * on by default.
 */
export function SchedulingTabs(): JSX.Element {
  const [view, setView] = useState<View>('agenda');
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth());

  return (
    <div className="eve-scheduling">
      <div className="eve-scheduling__tabs">
        <button
          type="button"
          className={view === 'agenda' ? 'eve-btn eve-btn--primary' : 'eve-btn'}
          onClick={() => setView('agenda')}
        >
          Agenda
        </button>
        <button
          type="button"
          className={view === 'posts' ? 'eve-btn eve-btn--primary' : 'eve-btn'}
          onClick={() => setView('posts')}
        >
          Posts agendados
        </button>
      </div>

      {view === 'agenda' ? (
        <MonthGrid
          year={year}
          month={month}
          onMonthChange={(nextYear, nextMonth) => {
            setYear(nextYear);
            setMonth(nextMonth);
          }}
        />
      ) : (
        <SchedulingCalendar />
      )}
    </div>
  );
}
