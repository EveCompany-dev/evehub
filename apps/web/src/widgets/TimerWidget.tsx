'use client';

import { Minus, Pause, Play, Plus, RotateCcw, strings, WidgetShell } from '@eve/ui';
import { useEffect, useRef, useState, type JSX } from 'react';
import { playAlertChime } from '../lib/alert-chime';
import type { WidgetProps } from './types';
import {
  DEFAULT_BREAK_MIN,
  DEFAULT_FOCUS_MIN,
  MAX_MINUTES,
  MIN_MINUTES,
  POMODORO_BREAK_MIN,
  POMODORO_FOCUS_MIN,
  formatClock,
  idle,
  isRunning,
  isStarted,
  pause,
  play,
  ringFill,
  tick,
} from './timer-machine';

const TICK_MS = 250;
const storageKey = (instanceId: string) => `eve.timer.pomodoro.${instanceId}`;

function readPomodoro(instanceId: string): boolean {
  try {
    return window.localStorage.getItem(storageKey(instanceId)) === '1';
  } catch {
    return false;
  }
}

function writePomodoro(instanceId: string, on: boolean): void {
  try {
    window.localStorage.setItem(storageKey(instanceId), on ? '1' : '0');
  } catch {
    // Private mode / blocked storage: the option just won't survive a reload.
  }
}

/** Focus/break countdown. The Pomodoro option pins it to 25 + 5 minutes and chains them. */
export function TimerWidget({ instanceId, title, onRemove }: WidgetProps): JSX.Element {
  const [pomodoro, setPomodoro] = useState(() => readPomodoro(instanceId));
  const [freeMinutes, setFreeMinutes] = useState({ focus: DEFAULT_FOCUS_MIN, break: DEFAULT_BREAK_MIN });
  const minutes = pomodoro ? { focus: POMODORO_FOCUS_MIN, break: POMODORO_BREAK_MIN } : freeMinutes;
  const [timer, setTimer] = useState(() => idle('focus', pomodoro ? POMODORO_FOCUS_MIN : DEFAULT_FOCUS_MIN));

  // Ring once each time a countdown completes (focus → break, and break → done).
  const rungFor = useRef(timer.completed);
  useEffect(() => {
    if (timer.completed > rungFor.current) playAlertChime();
    rungFor.current = timer.completed;
  }, [timer.completed]);

  const running = isRunning(timer);
  const started = isStarted(timer);

  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => {
      setTimer((current) => tick(current, Date.now(), pomodoro, { focus: minutes.focus, break: minutes.break }));
    }, TICK_MS);
    return () => clearInterval(id);
  }, [running, pomodoro, minutes.focus, minutes.break]);

  const togglePomodoro = () => {
    const next = !pomodoro;
    writePomodoro(instanceId, next);
    setPomodoro(next);
    setTimer(idle('focus', next ? POMODORO_FOCUS_MIN : freeMinutes.focus));
  };

  const reset = () => setTimer(idle('focus', minutes.focus));


  const adjust = (delta: number) => {
    if (pomodoro) return;
    const phase = timer.phase;
    const next = Math.min(MAX_MINUTES, Math.max(MIN_MINUTES, minutes[phase] + delta));
    setFreeMinutes((current) => ({ ...current, [phase]: next }));
    setTimer(idle(phase, next));
  };

  const toggleRun = () => setTimer((current) => (isRunning(current) ? pause(current, Date.now()) : play(current, Date.now())));

  // An untouched timer shows only the gray track; the arc appears (full) on play.
  const fill = ringFill(timer, pomodoro);

  return (
    <WidgetShell
      title={title}
      status="ok"
      actions={[
        { label: 'Timer Pomodoro', checked: pomodoro, onSelect: togglePomodoro },
        { label: strings.dashboard.removeWidget, onSelect: onRemove, danger: true },
      ]}
    >
      <div className="eve-timer eve-no-drag">
        <button
          type="button"
          className="eve-timer__ring"
          onClick={toggleRun}
          aria-label={running ? 'Pausar' : 'Iniciar'}
        >
          <svg className="eve-timer__dial" viewBox="0 0 120 120" aria-hidden="true">
            <circle className="eve-timer__track" cx="60" cy="60" r="50" pathLength={100} />
            <circle
              className="eve-timer__arc"
              cx="60"
              cy="60"
              r="50"
              pathLength={100}
              strokeDasharray={`${fill * 100} 100`}
              data-phase={timer.phase}
              style={{ opacity: started ? 1 : 0 }}
            />
          </svg>
          <span className="eve-timer__glyph">
            {running ? <Pause size={22} aria-hidden="true" /> : <Play size={22} aria-hidden="true" />}
          </span>
        </button>

        <div className="eve-timer__clock" role="timer" aria-live="off">
          {!pomodoro && (
            <button
              type="button"
              className="eve-timer__step"
              aria-label="Diminuir um minuto"
              disabled={minutes[timer.phase] <= MIN_MINUTES}
              onClick={() => adjust(-1)}
            >
              <Minus size={16} aria-hidden="true" />
            </button>
          )}
          <span className="eve-timer__time">{formatClock(timer.remainingMs)}</span>
          {!pomodoro && (
            <button
              type="button"
              className="eve-timer__step"
              aria-label="Aumentar um minuto"
              disabled={minutes[timer.phase] >= MAX_MINUTES}
              onClick={() => adjust(1)}
            >
              <Plus size={16} aria-hidden="true" />
            </button>
          )}
        </div>

        {/* Hidden (not removed) while untouched so the layout doesn't jump on play. */}
        <button type="button" className="eve-timer__reset" onClick={reset} disabled={!started} aria-hidden={!started}>
          <RotateCcw size={14} aria-hidden="true" />
          Reiniciar
        </button>
      </div>
    </WidgetShell>
  );
}
