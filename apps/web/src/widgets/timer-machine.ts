export type TimerPhase = 'focus' | 'break';

export const POMODORO_FOCUS_MIN = 25;
export const POMODORO_BREAK_MIN = 5;
export const DEFAULT_FOCUS_MIN = 25;
export const DEFAULT_BREAK_MIN = 5;
export const MIN_MINUTES = 1;
export const MAX_MINUTES = 180;

export interface TimerState {
  phase: TimerPhase;
  durationMs: number;
  remainingMs: number;
  /** Wall-clock moment the countdown hits zero; null while idle or paused. */
  endsAt: number | null;
  /** Bumped each time a countdown reaches zero, so the UI can ring once per completion. */
  completed: number;
}

export const minutesToMs = (minutes: number): number => minutes * 60_000;

/** A stopped timer, full, waiting for play. */
export function idle(phase: TimerPhase, minutes: number): TimerState {
  const durationMs = minutesToMs(minutes);
  return { phase, durationMs, remainingMs: durationMs, endsAt: null, completed: 0 };
}

export const isRunning = (state: TimerState): boolean => state.endsAt !== null;

/** Paused halfway counts as started too: the ring already shows progress. */
export const isStarted = (state: TimerState): boolean => isRunning(state) || state.remainingMs < state.durationMs;

export function play(state: TimerState, now: number): TimerState {
  if (isRunning(state)) return state;
  return { ...state, endsAt: now + state.remainingMs };
}

export function pause(state: TimerState, now: number): TimerState {
  if (state.endsAt === null) return state;
  return { ...state, remainingMs: Math.max(0, state.endsAt - now), endsAt: null };
}

/**
 * Advances a running timer to `now`. On reaching zero:
 *  - pomodoro focus → the break starts by itself, carrying over any overshoot;
 *  - pomodoro break → back to a fresh, stopped focus session;
 *  - free mode → the phase just returns to a fresh, stopped state.
 */
export function tick(
  state: TimerState,
  now: number,
  pomodoro: boolean,
  minutes: { focus: number; break: number },
): TimerState {
  if (state.endsAt === null) return state;

  const remainingMs = state.endsAt - now;
  if (remainingMs > 0) return { ...state, remainingMs };

  if (pomodoro && state.phase === 'focus') {
    const next = idle('break', minutes.break);
    return { ...next, endsAt: now + next.durationMs, completed: state.completed + 1 };
  }
  return { ...idle('focus', minutes.focus), completed: state.completed + 1 };
}

/**
 * Share of the ring that is filled, 0..1. Focus drains from full to empty; a
 * Pomodoro break runs the same clock in reverse, refilling the ring until it is
 * back at its starting position. A free-mode break drains like any countdown.
 */
export function ringFill(state: TimerState, pomodoro: boolean): number {
  const remaining = state.durationMs === 0 ? 0 : state.remainingMs / state.durationMs;
  return pomodoro && state.phase === 'break' ? 1 - remaining : remaining;
}

export function formatClock(ms: number): string {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}
