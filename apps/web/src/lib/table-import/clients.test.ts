import { describe, expect, it } from 'vitest';
import { matchClient, normalizeName, relationNames, stripNotionLinks } from './clients';

const CLIENTS = [
  { id: 'c1', label: '4s Estamparia' },
  { id: 'c2', label: 'Marcotex' },
  { id: 'c3', label: 'MH Têxtil' },
  { id: 'c4', label: 'Nacional Painéis' },
  { id: 'c5', label: 'Dicasa Móveis e Eletros' },
];

describe('normalizeName', () => {
  it('ignores case, accents and spacing', () => {
    expect(normalizeName('  Nacional  PAINÉIS ')).toBe('nacional paineis');
  });
});

describe('relationNames', () => {
  it('splits a Notion relation cell on its links, not on commas', () => {
    const cell = 'Dicasa, Móveis (https://www.notion.so/Dicasa-abc123), 4s Estamparia (https://www.notion.so/4s-def456)';
    expect(relationNames(cell)).toEqual(['Dicasa, Móveis', '4s Estamparia']);
  });

  it('treats a plain cell as one name and strips links', () => {
    expect(relationNames('CRF Construtora ')).toEqual(['CRF Construtora']);
    expect(relationNames('')).toEqual([]);
    expect(stripNotionLinks('Marcotex (https://www.notion.so/Marcotex-1)')).toBe('Marcotex');
  });
});

describe('matchClient', () => {
  it('matches exactly, ignoring case and accents', () => {
    expect(matchClient('nacional paineis', CLIENTS).exact?.id).toBe('c4');
    expect(matchClient('4S ESTAMPARIA', CLIENTS).exact?.id).toBe('c1');
  });

  it('suggests — but does not claim — a similar client', () => {
    expect(matchClient('4S Estamparia Digital', CLIENTS)).toMatchObject({ exact: null, suggestion: { id: 'c1' } });
    expect(matchClient('Marcotex Têxtil', CLIENTS)).toMatchObject({ exact: null, suggestion: { id: 'c2' } });
    expect(matchClient('Dicasa', CLIENTS)).toMatchObject({ exact: null, suggestion: { id: 'c5' } });
  });

  it('suggests nothing for an unrelated name or one sharing only a trailing word', () => {
    expect(matchClient('Averzzy', CLIENTS)).toEqual({ exact: null, suggestion: null });
    expect(matchClient('Krauller Têxtil', CLIENTS).suggestion).toBeNull();
  });
});
