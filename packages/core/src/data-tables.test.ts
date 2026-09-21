import { describe, expect, it } from 'vitest';
import { coerceColumnValue, dataColumnSchema, slugifyColumnKey, splitTagList } from './data-tables';

describe('column schema', () => {
  it('accepts the tag, link and relation types and per-option colors', () => {
    for (const type of ['text', 'number', 'boolean', 'date', 'select', 'multiselect', 'url', 'client']) {
      expect(dataColumnSchema.safeParse({ key: 'k', label: 'L', type }).success, type).toBe(true);
    }
    const tagged = dataColumnSchema.parse({ key: 'tags', label: 'Tags', type: 'multiselect', options: ['A'], optionColors: { A: 'green' } });
    expect(tagged.optionColors).toEqual({ A: 'green' });
  });

  it('still accepts a legacy select column that has options but no colors', () => {
    expect(dataColumnSchema.safeParse({ key: 's', label: 'S', type: 'select', options: ['x', 'y'] }).success).toBe(true);
  });

  it('rejects an unknown type', () => {
    expect(dataColumnSchema.safeParse({ key: 'k', label: 'L', type: 'wat' }).success).toBe(false);
  });
});

describe('coerceColumnValue', () => {
  it('turns tag lists into arrays, from arrays or comma text', () => {
    expect(coerceColumnValue(['Reels', ' Feed ', 'Reels'], 'multiselect')).toEqual(['Reels', 'Feed']);
    expect(coerceColumnValue('Reels, Feed', 'multiselect')).toEqual(['Reels', 'Feed']);
    expect(coerceColumnValue('', 'multiselect')).toEqual([]);
    expect(coerceColumnValue(null, 'multiselect')).toBeNull();
  });

  it('keeps the existing coercions', () => {
    expect(coerceColumnValue('12', 'number')).toBe(12);
    expect(coerceColumnValue('abc', 'number')).toBeNull();
    expect(coerceColumnValue('true', 'boolean')).toBe(true);
    expect(coerceColumnValue(5, 'text')).toBe('5');
    expect(coerceColumnValue('https://x.io', 'url')).toBe('https://x.io');
  });
});

describe('helpers', () => {
  it('splits and de-duplicates a tag list', () => {
    expect(splitTagList('a, b;c\nd,, a')).toEqual(['a', 'b', 'c', 'd']);
  });

  it('slugs accented labels and disambiguates', () => {
    expect(slugifyColumnKey('Título do Conteúdo', [])).toBe('titulo_do_conteudo');
    expect(slugifyColumnKey('Status', ['status'])).toBe('status_2');
    expect(slugifyColumnKey('!!!', [])).toBe('campo');
  });
});
