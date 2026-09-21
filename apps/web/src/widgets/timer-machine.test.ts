import { describe, expect, it } from 'vitest';
import { formatClock, idle, isStarted, pause, play, ringFill, tick } from './timer-machine';

const pomodoro = { focus: 25, break: 5 };

describe('timer-machine', () => {
  it('counts down and pauses with the remaining time', () => {
    const running = play(idle('focus', 25), 0);
    const ticked = tick(running, 60_000, true, pomodoro);
    expect(ticked.remainingMs).toBe(24 * 60_000);

    const paused = pause(ticked, 60_000);
    expect(paused.endsAt).toBeNull();
    expect(isStarted(paused)).toBe(true);
    expect(play(paused, 1_000_000).endsAt).toBe(1_000_000 + 24 * 60_000);
  });

  it('starts the break by itself when a pomodoro focus ends', () => {
    const running = play(idle('focus', 25), 0);
    const next = tick(running, 25 * 60_000, true, pomodoro);
    expect(next.phase).toBe('break');
    expect(next.completed).toBe(1);
    expect(next.durationMs).toBe(5 * 60_000);
    expect(next.endsAt).toBe(25 * 60_000 + 5 * 60_000);
  });

  it('returns to a stopped focus when the pomodoro break ends', () => {
    const running = play(idle('break', 5), 0);
    const next = tick(running, 5 * 60_000, true, pomodoro);
    expect(next).toEqual({ ...idle('focus', 25), completed: 1 });
  });

  it('does not chain into a break outside pomodoro mode', () => {
    const running = play(idle('focus', 10), 0);
    expect(tick(running, 10 * 60_000, false, { focus: 10, break: 5 })).toEqual({ ...idle('focus', 10), completed: 1 });
  });

  it('drains during focus and refills, ending at the start, during a pomodoro break', () => {
    expect(ringFill(idle('focus', 25), true)).toBe(1);
    const halfFocus = tick(play(idle('focus', 25), 0), 12.5 * 60_000, true, pomodoro);
    expect(ringFill(halfFocus, true)).toBeCloseTo(0.5);

    const breakStart = idle('break', 5);
    expect(ringFill(breakStart, true)).toBe(0);
    const halfBreak = tick(play(breakStart, 0), 2.5 * 60_000, true, pomodoro);
    expect(ringFill(halfBreak, true)).toBeCloseTo(0.5);
    const almostDone = tick(play(breakStart, 0), 5 * 60_000 - 1, true, pomodoro);
    expect(ringFill(almostDone, true)).toBeCloseTo(1, 3);
  });

  it('formats mm:ss rounding partial seconds up', () => {
    expect(formatClock(25 * 60_000)).toBe('25:00');
    expect(formatClock(59_001)).toBe('01:00');
    expect(formatClock(0)).toBe('00:00');
  });
});
