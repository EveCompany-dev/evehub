import { describe, expect, it } from 'vitest';
import { RETIRED_STATUS, SYSTEM_TABLES, splitRetiredStatus, statusAfterSplit } from './system-tables';

const legacyStatus = {
  key: 'status',
  label: 'Status',
  type: 'select' as const,
  options: ['Ideia', 'Em aprovação', RETIRED_STATUS, 'Pausado'],
  optionColors: { Ideia: 'yellow', 'Em aprovação': 'orange', [RETIRED_STATUS]: 'green', Pausado: 'gray' },
};

describe('splitRetiredStatus', () => {
  it('puts Programado + Publicado where the combined tag was, and Falhou at the end', () => {
    const [status] = splitRetiredStatus([legacyStatus])!;
    expect(status!.options).toEqual(['Ideia', 'Em aprovação', 'Programado', 'Publicado', 'Pausado', 'Falhou']);
    expect(status!.optionColors).toEqual({ Ideia: 'yellow', 'Em aprovação': 'orange', Pausado: 'gray', Programado: 'pink', Publicado: 'green', Falhou: 'red' });
  });

  it('leaves other columns alone, and does nothing the second time', () => {
    const title = { key: 'titulo', label: 'Título', type: 'text' as const };
    const upgraded = splitRetiredStatus([title, legacyStatus])!;
    expect(upgraded[0]).toBe(title);
    expect(splitRetiredStatus(upgraded)).toBeNull();
  });

  it('is already done for a table created now', () => {
    expect(splitRetiredStatus(SYSTEM_TABLES.content.columns)).toBeNull();
  });
});

describe('statusAfterSplit', () => {
  it('reads a past date as published and today or later as scheduled', () => {
    expect(statusAfterSplit('2026-09-10', '2026-09-22')).toBe('Publicado');
    expect(statusAfterSplit('10/09/2026', '2026-09-22')).toBe('Publicado');
    expect(statusAfterSplit('2026-09-22', '2026-09-22')).toBe('Programado');
    expect(statusAfterSplit('30/09/2026', '2026-09-22')).toBe('Programado');
  });

  it('calls an unreadable or missing date scheduled rather than claim it went out', () => {
    expect(statusAfterSplit('semana que vem', '2026-09-22')).toBe('Programado');
    expect(statusAfterSplit(undefined, '2026-09-22')).toBe('Programado');
  });
});
