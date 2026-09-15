import { describe, expect, it } from 'vitest';
import { fold, rank, scoreItem, scoreOne } from './command-search';

interface Entry {
  id: string;
  label: string;
  hint?: string;
  keywords?: string[];
}

const entries: Entry[] = [
  { id: 'nav:/scheduling', label: 'Agenda', hint: '/scheduling', keywords: ['posts', 'publicacao', 'calendario'] },
  { id: 'nav:/jobs', label: 'Jobs', hint: '/jobs', keywords: ['tarefas', 'kanban'] },
  { id: 'setting:cursorFollower', label: 'Bolinha que segue o mouse', keywords: ['cursor', 'ponteiro'] },
  { id: 'setting:uiScale', label: 'Escala da interface', keywords: ['zoom', 'tamanho'] },
  { id: 'screen:1', label: 'Performance Cliente X' },
  { id: 'add:notion', label: 'Notion', hint: 'Páginas e bases do Notion' },
];

const idOf = (entry: Entry) => entry.id;

describe('fold', () => {
  it('strips accents and case, so the user never has to type them', () => {
    expect(fold('Publicação')).toBe('publicacao');
    expect(fold('AGÊNCIA')).toBe('agencia');
  });
});

describe('scoreOne', () => {
  it('ranks exact over prefix over word-start over substring', () => {
    const exact = scoreOne('agenda', 'Agenda');
    const prefix = scoreOne('age', 'Agenda');
    const wordStart = scoreOne('cliente', 'Performance Cliente X');
    const substring = scoreOne('erforman', 'Performance Cliente X');

    expect(exact).toBeGreaterThan(prefix);
    expect(prefix).toBeGreaterThan(wordStart);
    expect(wordStart).toBeGreaterThan(substring);
  });

  it('matches a scattered subsequence but ranks it below a real substring', () => {
    const scattered = scoreOne('eia', 'Escala da interface');
    expect(scattered).toBeGreaterThan(-1);
    expect(scattered).toBeLessThan(scoreOne('interface', 'Escala da interface'));
  });

  it('rejects characters that are not there, or are out of order', () => {
    expect(scoreOne('xyz', 'Agenda')).toBe(-1);
    expect(scoreOne('adnega', 'Agenda')).toBe(-1);
  });

  it('prefers the shorter of two equally-matching labels', () => {
    expect(scoreOne('job', 'Jobs')).toBeGreaterThan(scoreOne('job', 'Jobs arquivados do ano passado'));
  });
});

describe('scoreItem', () => {
  it('finds an entry by a keyword the label never mentions', () => {
    const scheduling = entries.find((entry) => entry.id === 'nav:/scheduling')!;
    expect(scoreItem('publicacao', scheduling)).toBeGreaterThan(-1);
  });

  it('weighs a label hit above a keyword hit above a hint hit', () => {
    const label = scoreItem('notion', { label: 'Notion' });
    const keyword = scoreItem('notion', { label: 'Outra coisa', keywords: ['notion'] });
    const hint = scoreItem('notion', { label: 'Outra coisa', hint: 'Notion' });

    expect(label).toBeGreaterThan(keyword);
    expect(keyword).toBeGreaterThan(hint);
  });
});

describe('rank', () => {
  it('puts the module the user meant first', () => {
    expect(rank('agenda', entries, { idOf })[0]!.id).toBe('nav:/scheduling');
    expect(rank('cursor', entries, { idOf })[0]!.id).toBe('setting:cursorFollower');
    expect(rank('zoom', entries, { idOf })[0]!.id).toBe('setting:uiScale');
  });

  it('finds a tela by name, which is what makes Ctrl+K able to fly to one', () => {
    expect(rank('performance', entries, { idOf })[0]!.id).toBe('screen:1');
  });

  it('drops everything that does not match at all', () => {
    expect(rank('qqqq', entries, { idOf })).toEqual([]);
  });

  it('keeps the given order when nothing is typed', () => {
    expect(rank('', entries, { idOf }).map(idOf)).toEqual(entries.map(idOf));
  });

  it('floats recent entries up on an empty query', () => {
    const ranked = rank('', entries, { idOf, recent: ['add:notion', 'nav:/jobs'] });
    expect(ranked.slice(0, 2).map(idOf)).toEqual(['add:notion', 'nav:/jobs']);
  });

  it('lets recency break a tie without overriding a clear winner', () => {
    // "Jobs" is the far better match for "jobs" even with the other entry
    // freshly used.
    const ranked = rank('jobs', entries, { idOf, recent: ['setting:uiScale'] });
    expect(ranked[0]!.id).toBe('nav:/jobs');
  });

  it('respects the limit, so the list stays navigable', () => {
    const many = Array.from({ length: 200 }, (_, index) => ({ id: `n${index}`, label: `Item ${index}` }));
    expect(rank('item', many, { idOf: (entry) => entry.id, limit: 10 })).toHaveLength(10);
  });
});
