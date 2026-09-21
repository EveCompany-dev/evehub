import { describe, expect, it } from 'vitest';
import { displayDate, looksLikeDate, parseLooseDate, toBrDate, toIsoDate } from './table-dates';

const REF = new Date(2026, 8, 21); // 21/09/2026

function ymd(date: Date | null): string | null {
  return date ? toIsoDate(date) : null;
}

describe('parseLooseDate', () => {
  it('reads the formats a Notion export produces', () => {
    expect(ymd(parseLooseDate('31/08/2026', REF))).toBe('2026-08-31');
    expect(ymd(parseLooseDate('2026-08-31', REF))).toBe('2026-08-31');
    expect(ymd(parseLooseDate('15 de setembro de 2026', REF))).toBe('2026-09-15');
    expect(ymd(parseLooseDate('15 de março de 2026', REF))).toBe('2026-03-15');
    expect(ymd(parseLooseDate('September 15, 2026', REF))).toBe('2026-09-15');
    expect(ymd(parseLooseDate('Sep 5 2026', REF))).toBe('2026-09-05');
    expect(ymd(parseLooseDate('@September 15, 2026 3:00 PM', REF))).toBe('2026-09-15');
    expect(ymd(parseLooseDate('15/09/2026 09:30', REF))).toBe('2026-09-15');
    expect(ymd(parseLooseDate('05/03/26', REF))).toBe('2026-03-05');
  });

  it('takes the start of a range', () => {
    expect(ymd(parseLooseDate('15/09/2026 → 20/09/2026', REF))).toBe('2026-09-15');
  });

  it('gives a year-less day/month the reference year', () => {
    expect(ymd(parseLooseDate('11/09', REF))).toBe('2026-09-11');
    expect(ymd(parseLooseDate('15 set', REF))).toBe('2026-09-15');
  });

  it('is day-first, and refuses impossible dates', () => {
    expect(ymd(parseLooseDate('01/02/2026', REF))).toBe('2026-02-01');
    expect(parseLooseDate('09/15/2026', REF)).toBeNull(); // month 15
    expect(parseLooseDate('31/02/2026', REF)).toBeNull();
    expect(parseLooseDate('32/01/2026', REF)).toBeNull();
  });

  it('does not mistake free text or numbers for dates', () => {
    for (const text of ['não vamos', 'Não fazer', '-', '', '6 Reels', '5 por semana', '1.5', '10-12', '12 Reels', 'Prefere a tarde 13h15']) {
      expect(looksLikeDate(text), text).toBe(false);
    }
  });
});

describe('date display', () => {
  it('shows machine ISO dates as dd/mm/yyyy and leaves everything else as written', () => {
    expect(displayDate('2026-09-15')).toBe('15/09/2026');
    expect(displayDate('15 de setembro de 2026')).toBe('15 de setembro de 2026');
    expect(displayDate('11/09')).toBe('11/09');
    expect(toBrDate(new Date(2026, 0, 5))).toBe('05/01/2026');
  });
});
