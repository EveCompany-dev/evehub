'use client';

import { useCallback, useEffect, useState, type JSX } from 'react';
import { useSearchParams } from 'next/navigation';
import { SchedulingCalendar } from './SchedulingCalendar';
import type { ScheduledPostRow } from './scheduling-types';

export interface SchedulingTabsProps {
  currentUserId: string;
}

/**
 * The old "Agenda" (a bare, event-less calendar) vs. "Posts agendados" pill
 * toggle is gone — the Agenda nav item in the side rail is now the entry
 * point for all of this (see SideRail.tsx's dropdown: Minha Agenda, Agendar
 * Post, Time), each landing here with a different search param instead of a
 * separate view to build and maintain. SchedulingCalendar already is a full
 * calendar (with post chips) plus a filterable list, so there's nothing the
 * old blank MonthGrid view did that this doesn't already cover better.
 */
export function SchedulingTabs({ currentUserId }: SchedulingTabsProps): JSX.Element {
  const searchParams = useSearchParams();
  const mine = searchParams.get('mine') === '1';
  const isNew = searchParams.get('new') === '1';

  // Posts fail at a moment nobody is watching, and the failure is invisible
  // from the default view. This count drives the notifications bell/nav
  // badge elsewhere — kept here too so refreshing after an edit stays cheap.
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
    <div className="eve-scheduling-tabs">
      {failedCount > 0 && (
        <p className="eve-alert eve-alert--error">
          {failedCount} post(s) não publicado(s) — role até “Falharam” na lista abaixo.
        </p>
      )}

      <SchedulingCalendar
        onPostsChanged={loadFailedCount}
        initialMemberFilter={mine ? currentUserId : undefined}
        autoOpenNew={isNew}
      />
    </div>
  );
}
