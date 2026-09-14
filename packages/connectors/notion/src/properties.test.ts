import { describe, expect, it } from 'vitest';
import { buildPropertyPayload, readPageProperties, readProperty, UnsupportedPropertyError } from './properties';
import { normalizeDatabaseId } from './shared';

describe('normalizeDatabaseId', () => {
  it('accepts the URL people actually copy from the address bar', () => {
    expect(normalizeDatabaseId('https://www.notion.so/eve/Clientes-24f1b2c3d4e5f60718293a4b5c6d7e8f?v=abc')).toBe(
      '24f1b2c3-d4e5-f607-1829-3a4b5c6d7e8f',
    );
  });

  it('accepts a bare id, hyphenated or not', () => {
    expect(normalizeDatabaseId('24f1b2c3d4e5f60718293a4b5c6d7e8f')).toBe('24f1b2c3-d4e5-f607-1829-3a4b5c6d7e8f');
    expect(normalizeDatabaseId('24f1b2c3-d4e5-f607-1829-3a4b5c6d7e8f')).toBe('24f1b2c3-d4e5-f607-1829-3a4b5c6d7e8f');
  });

  it('rejects junk instead of sending a bad id to Notion', () => {
    expect(normalizeDatabaseId('')).toBeNull();
    expect(normalizeDatabaseId('https://notion.so/eve/Clientes')).toBeNull();
    expect(normalizeDatabaseId('nao-e-um-id')).toBeNull();
  });
});

describe('readProperty', () => {
  it('flattens rich text and titles', () => {
    expect(readProperty({ type: 'title', title: [{ plain_text: 'Art ' }, { plain_text: 'Colchoes' }] })).toBe(
      'Art Colchoes',
    );
    expect(readProperty({ type: 'rich_text', rich_text: [] })).toBe('');
  });

  it('reads select, status and multi_select', () => {
    expect(readProperty({ type: 'select', select: { name: 'Ativo' } })).toBe('Ativo');
    expect(readProperty({ type: 'select', select: null })).toBe('');
    expect(readProperty({ type: 'status', status: { name: 'Em andamento' } })).toBe('Em andamento');
    expect(readProperty({ type: 'multi_select', multi_select: [{ name: 'A' }, { name: 'B' }] })).toBe('A, B');
  });

  it('keeps numbers and checkboxes as their real types', () => {
    expect(readProperty({ type: 'number', number: 1200 })).toBe(1200);
    expect(readProperty({ type: 'number', number: null })).toBe('');
    expect(readProperty({ type: 'checkbox', checkbox: true })).toBe(true);
  });

  it('renders date ranges readably', () => {
    expect(readProperty({ type: 'date', date: { start: '2026-09-11' } })).toBe('2026-09-11');
    expect(readProperty({ type: 'date', date: { start: '2026-09-01', end: '2026-09-30' } })).toBe(
      '2026-09-01 → 2026-09-30',
    );
    expect(readProperty({ type: 'date', date: null })).toBe('');
  });

  it('unwraps formulas and rollups to their inner value', () => {
    expect(readProperty({ type: 'formula', formula: { type: 'number', number: 42 } })).toBe(42);
    expect(readProperty({ type: 'rollup', rollup: { type: 'array', array: [1, 2, 3] } })).toBe('3 item(ns)');
  });

  it('never throws on an unknown or missing property', () => {
    expect(readProperty({ type: 'inventado' })).toBe('');
    expect(readProperty(undefined)).toBeNull();
  });

  it('maps a whole page', () => {
    expect(
      readPageProperties({
        Nome: { type: 'title', title: [{ plain_text: 'Classe Moveis' }] },
        Status: { type: 'select', select: { name: 'Ativo' } },
      }),
    ).toEqual({ Nome: 'Classe Moveis', Status: 'Ativo' });
  });
});

describe('buildPropertyPayload', () => {
  it('builds text payloads', () => {
    expect(buildPropertyPayload('Nome', 'title', 'Eve')).toEqual({
      title: [{ type: 'text', text: { content: 'Eve' } }],
    });
  });

  it('clears a field with an empty value rather than writing an empty string', () => {
    expect(buildPropertyPayload('Obs', 'rich_text', '')).toEqual({ rich_text: [] });
    expect(buildPropertyPayload('Status', 'select', '')).toEqual({ select: null });
    expect(buildPropertyPayload('Site', 'url', '')).toEqual({ url: null });
    expect(buildPropertyPayload('Valor', 'number', '')).toEqual({ number: null });
  });

  it('accepts a comma as the decimal separator, as pt-BR users type it', () => {
    expect(buildPropertyPayload('Valor', 'number', '1200,50')).toEqual({ number: 1200.5 });
  });

  it('rejects a number that is not one', () => {
    expect(() => buildPropertyPayload('Valor', 'number', 'abc')).toThrow(/espera um número/);
  });

  it('sends only the start of a rendered date range back', () => {
    expect(buildPropertyPayload('Prazo', 'date', '2026-09-01 → 2026-09-30')).toEqual({
      date: { start: '2026-09-01' },
    });
  });

  it('refuses to write a computed property instead of silently dropping it', () => {
    expect(() => buildPropertyPayload('Total', 'formula', '10')).toThrow(UnsupportedPropertyError);
    expect(() => buildPropertyPayload('Tags', 'multi_select', 'a')).toThrow(UnsupportedPropertyError);
  });
});
