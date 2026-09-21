import { describe, expect, it } from 'vitest';
import type { DataColumn, DataTableRowValue } from '../components/data-table-types';
import { csvField, toCsv } from './table-csv';
import { buildImportPlan, toImportPayload } from './table-import/plan';

const COLUMNS: DataColumn[] = [
  { key: 'titulo', label: 'Título', type: 'text' },
  { key: 'status', label: 'Status', type: 'select', options: ['Ideia', 'Publicado'] },
  { key: 'tags', label: 'Tags', type: 'multiselect', options: ['Reels', 'Feed', 'Institucional'] },
  { key: 'data', label: 'Data', type: 'date' },
  { key: 'ok', label: 'Aprovado', type: 'boolean' },
  { key: 'n', label: 'Curtidas', type: 'number' },
  { key: 'cliente', label: 'Cliente', type: 'client' },
];

const row = (id: string, data: Record<string, unknown>): DataTableRowValue => ({ id, tableId: 't', data });

const ROWS = [
  row('1', { titulo: 'Carrossel, "Uniformes"', status: 'Publicado', tags: ['Reels', 'Feed'], data: '2026-08-31', ok: true, n: 1200, cliente: 'c1' }),
  row('2', { titulo: 'Linha 1\nLinha 2', status: 'Ideia', tags: ['Feed', 'Institucional'], data: '11/09/2026', ok: false, n: 5, cliente: 'c2' }),
  row('3', { titulo: 'Outro', status: 'Ideia', tags: ['Reels'], data: '15 de setembro de 2026', ok: true, n: 7, cliente: 'c1' }),
];

const LABELS = { c1: '4s Estamparia', c2: 'Marcotex' };

describe('csvField', () => {
  it('quotes only when needed', () => {
    expect(csvField('plain')).toBe('plain');
    expect(csvField('a,b')).toBe('"a,b"');
    expect(csvField('say "hi"')).toBe('"say ""hi"""');
    expect(csvField('two\nlines')).toBe('"two\nlines"');
    expect(csvField(null)).toBe('');
  });
});

describe('toCsv', () => {
  it('writes tags, dates, checkboxes and clients the way they read', () => {
    const csv = toCsv(COLUMNS, ROWS, LABELS);
    expect(csv.startsWith('﻿Título,Status,Tags,Data,Aprovado,Curtidas,Cliente')).toBe(true);
    expect(csv).toContain('"Reels, Feed"');
    expect(csv).toContain('31/08/2026'); // ISO date shown as dd/mm/yyyy
    expect(csv).toContain('15 de setembro de 2026'); // written dates untouched
    expect(csv).toContain('Yes');
    expect(csv).toContain('4s Estamparia');
  });

  it('round-trips through the importer: what was exported comes back typed the same', () => {
    const csv = toCsv(COLUMNS, ROWS, LABELS);
    const plan = buildImportPlan({
      fileName: 'Exportada.csv',
      bytes: new TextEncoder().encode(csv),
      clients: [
        { id: 'c1', label: '4s Estamparia' },
        { id: 'c2', label: 'Marcotex' },
      ],
    });

    const types = Object.fromEntries(plan.columns.map((column) => [column.label, column.type]));
    expect(types).toMatchObject({ Título: 'text', Tags: 'multiselect', Data: 'date', Aprovado: 'boolean', Curtidas: 'number', Cliente: 'client' });
    // No doubts raised: the client names all match exactly and every date reads.
    expect(plan.columns.flatMap((column) => column.issues)).toEqual([]);

    const payload = toImportPayload(plan);
    const labels = payload.columns.map((column) => column.label);
    expect(payload.rows[0]![labels.indexOf('Título')]).toBe('Carrossel, "Uniformes"');
    expect(payload.rows[1]![labels.indexOf('Título')]).toBe('Linha 1\nLinha 2');
    expect(payload.rows.map((cells) => cells[labels.indexOf('Tags')])).toEqual([['Reels', 'Feed'], ['Feed', 'Institucional'], ['Reels']]);
    expect(payload.rows.map((cells) => cells[labels.indexOf('Cliente')])).toEqual(['c1', 'c2', 'c1']);
    expect(payload.rows.map((cells) => cells[labels.indexOf('Aprovado')])).toEqual([true, false, true]);
    expect(payload.newClients).toEqual([]);
  });
});
