import { describe, expect, it } from 'vitest';
import { parseLooseNumber } from './numbers';

const value = (text: string, locale?: 'pt' | 'en') => parseLooseNumber(text, locale)?.value ?? null;

describe('parseLooseNumber', () => {
  it('reads plain, pt-BR and en numbers', () => {
    expect(value('1234')).toBe(1234);
    expect(value('12.5')).toBe(12.5);
    expect(value('12,5')).toBe(12.5);
    expect(value('1.234,56')).toBe(1234.56);
    expect(value('1,234.56')).toBe(1234.56);
    expect(value('1.234.567')).toBe(1234567);
    expect(value('-7')).toBe(-7);
  });

  it('strips currency and percent', () => {
    expect(value('R$ 1.500,00')).toBe(1500);
    expect(value('$1,500.00')).toBe(1500);
    expect(value('12%')).toBe(12);
  });

  it('flags "1.234" as ambiguous and honors the chosen locale', () => {
    expect(parseLooseNumber('1.234', 'pt')).toEqual({ value: 1234, ambiguous: true });
    expect(parseLooseNumber('1.234', 'en')).toEqual({ value: 1.234, ambiguous: true });
    expect(parseLooseNumber('1,234', 'en')).toEqual({ value: 1234, ambiguous: true });
    expect(parseLooseNumber('1,234', 'pt')).toEqual({ value: 1.234, ambiguous: true });
    expect(parseLooseNumber('12.5')?.ambiguous).toBe(false);
  });

  it('refuses codes and text', () => {
    expect(value('007')).toBeNull();
    expect(value('0123')).toBeNull();
    expect(value('6 Reels')).toBeNull();
    expect(value('abc')).toBeNull();
    expect(value('')).toBeNull();
    expect(value('12/09')).toBeNull();
    expect(value('1.2.3')).toBeNull();
    expect(value('0,5')).toBe(0.5);
  });
});
