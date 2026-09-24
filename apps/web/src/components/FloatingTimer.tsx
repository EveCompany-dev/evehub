'use client';

import { strings, X } from '@eve/ui';
import { useEffect, useRef, useState, type JSX, type PointerEvent as ReactPointerEvent } from 'react';
import { formatElapsed, type TimeEntrySummary } from './job-types';
import { CollapseIcon, PauseIcon, PlayIcon } from './TimerIcons';

/** Below this many pixels of pointer travel, a press-and-release on the handle counts as a click (toggle collapse) rather than a drag. */
const DRAG_THRESHOLD_PX = 4;

export interface FloatingTimerProps {
  entry: TimeEntrySummary;
  /** A start/stop is in flight — the button must not look like it already landed. */
  pending?: boolean;
  onStop: () => void;
  onRestart: () => void;
  onDismiss: () => void;
}

interface Position {
  x: number;
  y: number;
}

const STORAGE_KEY = 'eve.jobs.timerPopupPos';
const DEFAULT_POSITION: Position = { x: 24, y: 24 };

/** How much of the popup must stay on screen to still be grabbable. */
const MIN_VISIBLE_PX = 48;

/**
 * Keeps the popup reachable. Dragged past an edge it simply stayed there, and
 * a stored position also outlives the window it was saved in — so a drag to
 * the corner on a big monitor left an invisible, unrecoverable timer on a
 * laptop. Clamped on every move and when the stored position is read back.
 */
function clampToViewport(position: Position): Position {
  if (typeof window === 'undefined') return position;
  const maxX = Math.max(0, window.innerWidth - MIN_VISIBLE_PX);
  const maxY = Math.max(0, window.innerHeight - MIN_VISIBLE_PX);
  return {
    x: Math.min(Math.max(position.x, 0), maxX),
    y: Math.min(Math.max(position.y, 0), maxY),
  };
}


/**
 * Shows whenever the caller has a timer worth showing — running (ticking,
 * pause icon) or just stopped (frozen, play icon so it can be restarted with
 * one click). Only disappears when explicitly dismissed or when a load
 * finds nothing at all; stopping a timer never hides it on its own. Draggable
 * (position kept per-viewer in localStorage).
 */
export function FloatingTimer({ entry, pending = false, onStop, onRestart, onDismiss }: FloatingTimerProps): JSX.Element {
  const isRunning = entry.endedAt === null;

  const [position, setPosition] = useState<Position>(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<Position>;
        if (typeof parsed.x === 'number' && typeof parsed.y === 'number') return clampToViewport({ x: parsed.x, y: parsed.y });
      }
    } catch {
      // Private window / blocked storage: stay at the default spot.
    }
    return DEFAULT_POSITION;
  });
  const [collapsed, setCollapsed] = useState(false);
  const [, setTick] = useState(0);
  const dragOrigin = useRef<Position | null>(null);
  const dragStart = useRef<Position | null>(null);
  const dragMoved = useRef(false);

  useEffect(() => {
    if (!isRunning) return;
    const interval = setInterval(() => setTick((value) => value + 1), 1000);
    return () => clearInterval(interval);
  }, [isRunning]);

  const handlePointerDown = (event: ReactPointerEvent<HTMLElement>) => {
    dragOrigin.current = position;
    dragStart.current = { x: event.clientX, y: event.clientY };
    dragMoved.current = false;
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLElement>) => {
    if (!dragOrigin.current || !dragStart.current) return;
    const dx = event.clientX - dragStart.current.x;
    const dy = event.clientY - dragStart.current.y;
    if (Math.abs(dx) > DRAG_THRESHOLD_PX || Math.abs(dy) > DRAG_THRESHOLD_PX) dragMoved.current = true;
    setPosition(clampToViewport({ x: dragOrigin.current.x + dx, y: dragOrigin.current.y + dy }));
  };

  const handlePointerUp = () => {
    dragOrigin.current = null;
    dragStart.current = null;
    if (!dragMoved.current) {
      setCollapsed((value) => !value);
      return;
    }
    setPosition((current) => {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(current));
      } catch {
        // Ignore: the position still works for this viewing session.
      }
      return current;
    });
  };

  const label = [entry.job?.title, entry.task?.title ?? strings.jobs.timesheetGeneral].filter(Boolean).join(' — ');

  const containerClass = [
    'eve-timer-popup',
    isRunning ? '' : 'is-stopped',
    collapsed ? 'is-collapsed' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={containerClass} style={{ left: position.x, top: position.y }}>
      <span
        className="eve-timer-popup__handle"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        title={collapsed ? strings.jobs.timerExpand : strings.jobs.timerCollapse}
      >
        <CollapseIcon collapsed={collapsed} />
        {collapsed && isRunning && <span className="eve-timer-popup__dot" aria-hidden="true" />}
      </span>

      {!collapsed && (
        <>
          <button
            type="button"
            className="eve-btn eve-btn--icon"
            disabled={pending}
            title={pending ? strings.jobs.timerStopping : isRunning ? strings.jobs.timesheetStop : strings.jobs.timerRestart}
            onClick={isRunning ? onStop : onRestart}
          >
            {isRunning ? <PauseIcon /> : <PlayIcon />}
          </button>
          <div className="eve-timer-popup__info">
            <span className="eve-timer-popup__label" title={label}>
              {label}
            </span>
            <span className="eve-timer-popup__elapsed">{formatElapsed(entry.startedAt, entry.endedAt)}</span>
          </div>
          <button type="button" className="eve-btn eve-btn--icon" title={strings.jobs.timerHide} onClick={onDismiss}>
            <X size={14} aria-hidden="true" />
          </button>
        </>
      )}
    </div>
  );
}
