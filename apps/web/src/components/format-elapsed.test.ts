import { describe, expect, it } from 'vitest';
import { formatElapsed } from './job-types';

const START = '2026-09-21T10:00:00.000Z';
const at = (seconds: number) => new Date(Date.parse(START) + seconds * 1000).toISOString();

describe('formatElapsed', () => {
  it('counts seconds and rolls over to minutes exactly once', () => {
    expect(formatElapsed(START, at(0))).toBe('0:00');
    expect(formatElapsed(START, at(1))).toBe('0:01');
    expect(formatElapsed(START, at(59))).toBe('0:59');
    expect(formatElapsed(START, at(60))).toBe('1:00');
    expect(formatElapsed(START, at(61))).toBe('1:01');
  });

  it('never repeats or skips a minute across a half-minute boundary', () => {
    // The regression: minutes came from durationMinutes (Math.round) while
    // seconds were floored, so :30 rounded the minute up and :00 snapped it
    // back. The display ran 1:30..1:59 then 1:00..1:29 — the same minute
    // twice. Walk two full minutes a second at a time and assert the clock
    // only ever moves forward.
    let previous = -1;
    for (let second = 0; second <= 180; second += 1) {
      const [minutes, seconds] = formatElapsed(START, at(second)).split(':').map(Number) as [number, number];
      const shown = minutes * 60 + seconds;
      expect(shown, `at ${second}s the clock showed ${minutes}:${String(seconds).padStart(2, '0')}`).toBe(second);
      expect(shown).toBeGreaterThan(previous);
      previous = shown;
    }
  });

  it('shows hours only once there is an hour to show', () => {
    expect(formatElapsed(START, at(59 * 60 + 59))).toBe('59:59');
    expect(formatElapsed(START, at(3600))).toBe('1:00:00');
    expect(formatElapsed(START, at(3661))).toBe('1:01:01');
    expect(formatElapsed(START, at(36000))).toBe('10:00:00');
  });

  it('treats a clock that went backwards as zero rather than negative', () => {
    expect(formatElapsed(START, at(-30))).toBe('0:00');
  });

  it('counts to now when the entry is still running', () => {
    const startedAt = new Date(Date.now() - 90_000).toISOString();
    expect(formatElapsed(startedAt, null)).toMatch(/^1:(29|30|31)$/);
  });
});
