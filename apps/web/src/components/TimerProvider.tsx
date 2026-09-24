'use client';

import { strings, X } from '@eve/ui';
import { createContext, useCallback, useContext, useEffect, useState, type JSX, type ReactNode } from 'react';
import { FloatingTimer } from './FloatingTimer';
import type { TimeEntrySummary } from './job-types';

export interface TimerContextValue {
  /** The caller's actually-running timer, or null. Drives play/pause state anywhere in the app. */
  runningEntry: TimeEntrySummary | null;
  /** True while a start or stop is in flight, so a button can show it hasn't landed yet. */
  pending: boolean;
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
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
    setPending(true);
    setError(null);
    void (async () => {
      try {
        const response = await fetch(`/api/jobs/${jobId}/time-entries`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ taskId }),
        });
        const body = (await response.json().catch(() => ({}))) as { entry?: TimeEntrySummary; error?: string };
        if (!response.ok || !body.entry) {
          setError(body.error ?? strings.jobs.timerStartFailed);
          return;
        }
        setRunningEntry(body.entry);
        setDisplayEntry(body.entry);
      } catch {
        setError(strings.jobs.timerStartFailed);
      } finally {
        setPending(false);
      }
    })();
  }, []);

  /**
   * Stops the running entry — and does NOT clear local state until the server
   * says it happened.
   *
   * This used to set `runningEntry` to null before sending the request and
   * swallow every failure, so a stop that never reached the server looked
   * exactly like one that worked: the icon flipped to "stopped" while the
   * entry stayed open and kept accruing. The 60s poll below then quietly put
   * the still-running entry back. That is billable client time, so a failure
   * here has to be loud and has to leave the timer visibly running.
   */
  const stopTimer = useCallback(() => {
    if (!runningEntry) return;
    const entry = runningEntry;
    setPending(true);
    setError(null);
    void (async () => {
      try {
        const response = await fetch(`/api/jobs/${entry.jobId}/time-entries/${entry.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ stop: true }),
        });
        const body = (await response.json().catch(() => ({}))) as { entry?: TimeEntrySummary; error?: string };
        if (!response.ok || !body.entry) {
          setError(body.error ?? strings.jobs.timerStopFailed);
          return;
        }
        setRunningEntry(null);
        setDisplayEntry(body.entry);
      } catch {
        setError(strings.jobs.timerStopFailed);
      } finally {
        setPending(false);
      }
    })();
  }, [runningEntry]);

  const restartDisplay = useCallback(() => {
    if (!displayEntry) return;
    startTimer(displayEntry.jobId, displayEntry.taskId);
  }, [displayEntry, startTimer]);

  return (
    <TimerContext.Provider value={{ runningEntry, pending, startTimer, stopTimer }}>
      {children}
      {displayEntry && (
        <FloatingTimer
          entry={displayEntry}
          pending={pending}
          onStop={stopTimer}
          onRestart={restartDisplay}
          onDismiss={() => setDisplayEntry(null)}
        />
      )}
      {error && (
        // Sits with the timer popup rather than in the page, because the timer
        // is started and stopped from anywhere in the app — there is no one
        // page that owns this failure.
        <div
          className="eve-alert eve-alert--error"
          role="alert"
          style={{ position: 'fixed', left: 24, bottom: 24, zIndex: 60, maxWidth: 380 }}
        >
          {error}{' '}
          <button type="button" className="eve-btn eve-btn--icon" onClick={() => setError(null)} title={strings.jobs.timerHide}>
            <X size={14} aria-hidden="true" />
          </button>
        </div>
      )}
    </TimerContext.Provider>
  );
}

export function useTimer(): TimerContextValue {
  const context = useContext(TimerContext);
  if (!context) throw new Error('useTimer must be used within a TimerProvider');
  return context;
}
