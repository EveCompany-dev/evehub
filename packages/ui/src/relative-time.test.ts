import { describe, expect, it } from 'vitest';
import { formatRelativeTime } from './relative-time';

const NOW = Date.parse('2026-09-11T12:00:00.000Z');

describe('formatRelativeTime', () => {
  it('returns null when there is no timestamp', () => {
    expect(formatRelativeTime(null, NOW)).toBeNull();
  });

  it('returns null for an unparseable string instead of NaN output', () => {
    expect(formatRelativeTime('not-a-date', NOW)).toBeNull();
  });

  it('collapses anything under a minute to "agora"', () => {
    expect(formatRelativeTime(new Date(NOW - 30_000), NOW)).toBe('agora');
  });

  it('formats minutes and hours', () => {
    expect(formatRelativeTime(new Date(NOW - 3 * 60_000), NOW)).toBe('ha 3 min');
    expect(formatRelativeTime(new Date(NOW - 60 * 60_000), NOW)).toBe('ha 1 hora');
    expect(formatRelativeTime(new Date(NOW - 5 * 60 * 60_000), NOW)).toBe('ha 5 horas');
  });

  it('formats days', () => {
    expect(formatRelativeTime(new Date(NOW - 25 * 60 * 60_000), NOW)).toBe('ha 1 dia');
    expect(formatRelativeTime(new Date(NOW - 3 * 24 * 60 * 60_000), NOW)).toBe('ha 3 dias');
  });

  it('treats a clock-skewed future timestamp as now rather than "ha -2 min"', () => {
    expect(formatRelativeTime(new Date(NOW + 120_000), NOW)).toBe('agora');
  });

  it('accepts ISO strings, which is what the API returns', () => {
    expect(formatRelativeTime('2026-09-11T11:55:00.000Z', NOW)).toBe('ha 5 min');
  });
});
