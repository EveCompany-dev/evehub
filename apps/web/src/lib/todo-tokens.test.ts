import { describe, expect, it } from 'vitest';
import {
  activeTrigger,
  applyPick,
  extractTokens,
  formatToken,
  fromEditable,
  parseTodoText,
  plainTodoText,
  tokenHref,
  toEditable,
  todoRenderParts,
} from './todo-tokens';

describe('to-do mention tokens', () => {
  it('parses plain text and tokens in order', () => {
    const text = 'Revisar @[Campanha set](job:j1) com @[Ana](person:u1) em /[Jobs](page:/jobs) hoje';
    expect(parseTodoText(text)).toEqual([
      { type: 'text', text: 'Revisar ' },
      { type: 'token', token: { kind: 'job', id: 'j1', label: 'Campanha set' }, raw: '@[Campanha set](job:j1)' },
      { type: 'text', text: ' com ' },
      { type: 'token', token: { kind: 'person', id: 'u1', label: 'Ana' }, raw: '@[Ana](person:u1)' },
      { type: 'text', text: ' em ' },
      { type: 'token', token: { kind: 'page', id: '/jobs', label: 'Jobs' }, raw: '/[Jobs](page:/jobs)' },
      { type: 'text', text: ' hoje' },
    ]);
  });

  it('leaves look-alikes as plain text: wrong prefix, unknown kind, a normal Markdown link', () => {
    for (const text of ['/[Job](job:j1)', '@[Jobs](page:/jobs)', '@[x](invoice:1)', 'veja [o site](https://eve.company)']) {
      expect(parseTodoText(text)).toEqual([{ type: 'text', text }]);
    }
  });

  it('formats a token that parses back to itself, cleaning labels that would break it', () => {
    const raw = formatToken('client', 'c9', 'Marca [nova] (2026)');
    expect(raw).toBe('@[Marca nova 2026](client:c9)');
    expect(extractTokens(`a ${raw} b`)).toEqual([{ kind: 'client', id: 'c9', label: 'Marca nova 2026' }]);
  });

  it('reads as plain text for people and the chat', () => {
    expect(plainTodoText('Ligar para @[Marcotex](client:c1) — ver /[Agenda](page:/agenda)')).toBe('Ligar para Marcotex — ver Agenda');
  });

  it('links each kind where the rest of the app already deep-links it', () => {
    expect(tokenHref('job', 'j1')).toBe('/jobs?job=j1');
    expect(tokenHref('client', 'c1')).toBe('/clients/c1');
    expect(tokenHref('project', 'p1')).toBe('/projects/p1');
    expect(tokenHref('table', 't1')).toBe('/tables?table=t1');
    expect(tokenHref('person', 'u1')).toBe('/team');
    expect(tokenHref('page', '/clients/calendar')).toBe('/clients/calendar');
  });

  it('never turns a page token into an off-site or script link', () => {
    expect(tokenHref('page', '//evil.example')).toBeNull();
    expect(tokenHref('page', 'https://evil.example')).toBeNull();
    expect(tokenHref('page', 'javascript:alert(1)')).toBeNull();
    // The id is encoded, so it can't break out of the path either.
    expect(tokenHref('job', 'a/../../x?y')).toBe('/jobs?job=a%2F..%2F..%2Fx%3Fy');
  });

  it('renders chips, with a plain-text fallback when the target is gone', () => {
    const text = 'Ver @[Job antigo](job:gone) e @[Job novo](job:j2) e @[Recem](job:j3)';
    const parts = todoRenderParts(text, { 'job:gone': null, 'job:j2': 'Job novo (renomeado)' });
    expect(parts).toEqual([
      { type: 'text', text: 'Ver ' },
      { type: 'missing', kind: 'job', label: 'Job antigo' },
      { type: 'text', text: ' e ' },
      // The current name wins over the one stored in the token.
      { type: 'chip', kind: 'job', label: 'Job novo (renomeado)', href: '/jobs?job=j2' },
      { type: 'text', text: ' e ' },
      // Not checked by the server yet (just typed): a chip with the stored label.
      { type: 'chip', kind: 'job', label: 'Recem', href: '/jobs?job=j3' },
    ]);
  });

  it('round-trips through the editor: "@Label" while typing, the token when saved', () => {
    const stored = 'Enviar @[Ana Paula](person:u2) o briefing de @[Ana](person:u1)';
    const editable = toEditable(stored);
    expect(editable.value).toBe('Enviar @Ana Paula o briefing de @Ana');
    expect(fromEditable(editable.value, editable.mentions)).toBe(stored);

    // Editing around a mention keeps it; deleting its text drops it.
    expect(fromEditable('Enviar hoje @Ana Paula o briefing', editable.mentions)).toBe('Enviar hoje @[Ana Paula](person:u2) o briefing');
    expect(fromEditable('Enviar o briefing', editable.mentions)).toBe('Enviar o briefing');
  });

  it('opens the picker only for an @ or / that starts a word', () => {
    expect(activeTrigger('Falar com @an', 13)).toEqual({ trigger: '@', query: 'an', start: 10 });
    expect(activeTrigger('/job', 4)).toEqual({ trigger: '/', query: 'job', start: 0 });
    expect(activeTrigger('mandar para ana@eve.company', 27)).toBeNull();
    expect(activeTrigger('entregar 12/10', 14)).toBeNull();
    expect(activeTrigger('Falar com @ana hoje', 19)).toBeNull();
  });

  it('inserts a picked mention in place of what was typed', () => {
    const value = 'Revisar @camp amanhã';
    const trigger = activeTrigger(value, 13)!;
    const next = applyPick({ value, mentions: [] }, trigger, 13, { kind: 'job', id: 'j1', label: 'Campanha set' });
    expect(next.value).toBe('Revisar @Campanha set  amanhã');
    expect(next.caret).toBe('Revisar @Campanha set '.length);
    expect(fromEditable(next.value, next.mentions)).toBe('Revisar @[Campanha set](job:j1)  amanhã');
  });
});
