'use client';

import { useCallback, useEffect, useState, type JSX } from 'react';
import { MonthGrid } from './MonthGrid';
import { SchedulingCalendar } from './SchedulingCalendar';
import type { ScheduledPostRow } from './scheduling-types';

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

  // Posts fail at a moment nobody is watching, and the failure is invisible
  // from the default view. This count drives the "!" that pulls someone into
  // the posts view to look — deliberately not date-bounded, since a post that
  // failed last month is still unresolved today.
  const [failedCount, setFailedCount] = useState(0);

  const loadFailedCount = useCallback(async () => {
    try {
      const response = await fetch('/api/scheduling/posts?status=failed', { cache: 'no-store' });
      if (!response.ok) return;
      const body = (await response.json()) as { posts: ScheduledPostRow[] };
      setFailedCount(body.posts.length);
    } catch {
      // A missing badge is not worth an error banner on the page.
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadFailedCount();
  }, [loadFailedCount]);

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
          {failedCount > 0 && (
            <span
              className="eve-tab-alert"
              title={`${failedCount} post(s) não publicado(s)`}
              aria-label={`${failedCount} post não publicado`}
            >
              !
            </span>
          )}
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
        <SchedulingCalendar onPostsChanged={loadFailedCount} />
      )}
    </div>
  );
}
