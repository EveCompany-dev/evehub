'use client';

import { createContext, useCallback, useContext, useEffect, useState, type JSX, type ReactNode } from 'react';
import { FloatingTimer } from './FloatingTimer';
import type { TimeEntrySummary } from './job-types';

export interface TimerContextValue {
  /** The caller's actually-running timer, or null. Drives play/pause state anywhere in the app. */
  runningEntry: TimeEntrySummary | null;
  startTimer: (jobId: string, taskId: string | null) => void;
  stopTimer: () => void;
}

const TimerContext = createContext<TimerContextValue | null>(null);

const POLL_INTERVAL_MS = 60_000;

/**
 * Site-wide timer state, mounted once in the root layout — not per-page —
 * so the floating popup and running-timer state work from anywhere, not just
 * the Jobs board. Stopping a timer only stops it; the popup keeps showing
 * the just-finished entry (frozen, play icon to restart) until the viewer
 * dismisses it or starts a different one.
 */
export function TimerProvider({ children }: { children: ReactNode }): JSX.Element {
  const [runningEntry, setRunningEntry] = useState<TimeEntrySummary | null>(null);
  const [displayEntry, setDisplayEntry] = useState<TimeEntrySummary | null>(null);

  const loadRunningEntry = useCallback(async () => {
    try {
      const response = await fetch('/api/jobs/time-entries/running', { cache: 'no-store' });
      const body = (await response.json().catch(() => ({}))) as { entry?: TimeEntrySummary | null };
      if (!response.ok) return;
      const entry = body.entry ?? null;
      setRunningEntry(entry);
      if (entry) setDisplayEntry(entry);
    } catch {
      // Non-critical: the popup just won't appear until the next successful poll.
    }
  }, []);

  useEffect(() => {
    // Mount fetch — setState happens after an await, same case as
    // useWidgetData.ts's initial fetch.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadRunningEntry();
    // Catches a timer started from another tab/device — the popup and any
    // open job's play/pause buttons would otherwise only learn about it the
    // next time this tab happens to start or stop one itself.
    const interval = setInterval(() => void loadRunningEntry(), POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [loadRunningEntry]);

  const startTimer = useCallback((jobId: string, taskId: string | null) => {
    void (async () => {
      try {
        const response = await fetch(`/api/jobs/${jobId}/time-entries`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ taskId }),
        });
        const body = (await response.json().catch(() => ({}))) as { entry?: TimeEntrySummary };
        if (response.ok && body.entry) {
          setRunningEntry(body.entry);
          setDisplayEntry(body.entry);
        }
      } catch {
        // The page that triggered this shows its own error banner via its
        // own fetch calls elsewhere; the timer state simply won't change.
      }
    })();
  }, []);

  const stopTimer = useCallback(() => {
    if (!runningEntry) return;
    const entry = runningEntry;
    setRunningEntry(null);
    void (async () => {
      try {
        const response = await fetch(`/api/jobs/${entry.jobId}/time-entries/${entry.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ stop: true }),
        });
        const body = (await response.json().catch(() => ({}))) as { entry?: TimeEntrySummary };
        if (response.ok && body.entry) setDisplayEntry(body.entry);
      } catch {
        // Ignore — the next poll reconciles state if this silently failed.
      }
    })();
  }, [runningEntry]);

  const restartDisplay = useCallback(() => {
    if (!displayEntry) return;
    startTimer(displayEntry.jobId, displayEntry.taskId);
  }, [displayEntry, startTimer]);

  return (
    <TimerContext.Provider value={{ runningEntry, startTimer, stopTimer }}>
      {children}
      {displayEntry && (
        <FloatingTimer
          entry={displayEntry}
          onStop={stopTimer}
          onRestart={restartDisplay}
          onDismiss={() => setDisplayEntry(null)}
        />
      )}
    </TimerContext.Provider>
  );
}

export function useTimer(): TimerContextValue {
  const context = useContext(TimerContext);
  if (!context) throw new Error('useTimer must be used within a TimerProvider');
  return context;
}
