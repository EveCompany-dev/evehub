import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  acceptClientSuggestions,
  buildImportPlan,
  reanalyzeColumn,
  resetColumnType,
  setClientAction,
  summarizePlan,
  toggleColumn,
  toImportPayload,
  type ImportPlan,
} from './plan';
import type { ClientRef } from './clients';

const CLIENTS: ClientRef[] = [
  { id: 'cl_4s', label: '4s Estamparia' },
  { id: 'cl_amo', label: 'AMO Imóveis' },
  { id: 'cl_marcotex', label: 'Marcotex' },
];

function fixture(name: string): Uint8Array {
  return new Uint8Array(readFileSync(new URL(`./__fixtures__/${name}`, import.meta.url)));
}

function fromText(text: string, fileName = 'Tabela.csv', clients: ClientRef[] = CLIENTS): ImportPlan {
  return buildImportPlan({ fileName, bytes: new TextEncoder().encode(text), clients });
}

const column = (plan: ImportPlan, label: string) => {
  const found = plan.columns.find((item) => item.label === label);
  if (!found) throw new Error(`no column "${label}" in ${plan.columns.map((item) => item.label).join(' | ')}`);
  return found;
};

const VISIBLE = 'Social Media Clientes 1352754f44e8804395bcf69a5c7d834a.csv';
const ALL = 'Social Media Clientes 1352754f44e8804395bcf69a5c7d834a_all.csv';

describe('a real Notion export (Social Media Clientes)', () => {
  it('imports the visible-view CSV: named after the database, columns typed, empty column skipped silently', () => {
    const plan = buildImportPlan({ fileName: VISIBLE, bytes: fixture(VISIBLE), clients: [] });

    expect(plan.tableName).toBe('Social Media Clientes');
    expect(plan.unusable).toBe(false);
    expect(plan.rows).toHaveLength(30);
    expect(plan.warnings).toEqual([]);

    expect(column(plan, 'Cliente').type).toBe('client');
    expect(column(plan, 'Status').type).toBe('select');
    expect(column(plan, 'Status').options).toEqual(['Ativa']);
    expect(column(plan, 'Status').optionColors).toEqual({ Ativa: 'green' });
    expect(column(plan, 'Social Media').options).toEqual(['Cris', 'Ananda', 'Shelly']);
    expect(column(plan, 'Reels Contratado').options).toContain('6 Reels');
    expect(column(plan, 'OBS foto e video').type).toBe('text');

    // "Ma" has no values at all: dropped without a fuss.
    expect(column(plan, 'Ma')).toMatchObject({ include: false, empty: true });
    expect(plan.skippedEmptyColumns).toBe(1);
  });

  it('flags the one value in the date column that is not a date, with its row', () => {
    const plan = buildImportPlan({ fileName: VISIBLE, bytes: fixture(VISIBLE), clients: [] });
    const dates = column(plan, 'Foto/Vídeo Julho');

    expect(dates.type).toBe('date');
    expect(dates.issues).toHaveLength(1);
    expect(dates.issues[0]).toMatchObject({ kind: 'mismatch', count: 1 });
    expect(dates.issues[0]!.examples).toEqual([{ row: 10, value: 'não vamos' }]);
  });

  it('imports the _all variant too, with its different column order and extra rows', () => {
    const plan = buildImportPlan({ fileName: ALL, bytes: fixture(ALL), clients: [] });

    expect(plan.tableName).toBe('Social Media Clientes');
    expect(plan.rows).toHaveLength(44);
    expect(column(plan, 'Status').options).toEqual(['Cancelado', 'Ativa']);
    expect(column(plan, 'Status').optionColors).toEqual({ Cancelado: 'red', Ativa: 'green' });
    expect(column(plan, 'Foto/Vídeo Julho').issues[0]!.count).toBe(6);
  });

  it('turns the plan into a payload that keeps row order and drops nothing it should keep', () => {
    const plan = buildImportPlan({ fileName: VISIBLE, bytes: fixture(VISIBLE), clients: CLIENTS });
    const payload = toImportPayload(plan);

    const labels = payload.columns.map((item) => item.label);
    expect(labels).not.toContain('Ma');
    expect(payload.rows).toHaveLength(30);

    const clienteIndex = labels.indexOf('Cliente');
    const statusIndex = labels.indexOf('Status');
    // First data row is "4S Estamparia Digital": not an exact match for "4s Estamparia" -> would be created.
    expect(payload.rows[0]![clienteIndex]).toBe('new:4S Estamparia Digital');
    // "AMO Imóveis" matches exactly (accents/case ignored).
    expect(payload.rows[1]![clienteIndex]).toBe('cl_amo');
    expect(payload.rows[0]![statusIndex]).toBe('Ativa');
    expect(payload.newClients).toContain('4S Estamparia Digital');
    expect(payload.newClients).not.toContain('AMO Imóveis');
  });
});

const POSTAGENS = [
  'Título do Conteúdo,Status,Data da Publicação,Tags 1.1,Formato de Conteúdo,Texto,Link da publicação,Aprovado,Curtidas,Cliente',
  'Carrossel Quantos Uniformes,Publicado/Programado,31/08/2026,"Reels, Feed",Carrossel,"Tela 1: Quantos uniformes?\nTela 2: faça a conta, simples",https://www.instagram.com/p/abc,Yes,1.234,4s Estamparia (https://www.notion.so/4s-Estamparia-1122754f44e88009aebaea47add27dc7)',
  'Reels Dr. Uniforme,Ideia,,Reels,Reels,,,No,980,4s Estamparia (https://www.notion.so/4s-Estamparia-1122754f44e88009aebaea47add27dc7)',
  'Post Família,Publicado/Programado,"September 11, 2026","Feed, Institucional",Feed,Legenda longa,https://www.instagram.com/p/def,Yes,2.5,Marcotex Têxtil (https://www.notion.so/Marcotex-Textil-99)',
  'Reels Cenas,Ideia,15 de setembro de 2026,Reels,Reels,,,No,10,Marcotex Têxtil (https://www.notion.so/Marcotex-Textil-99)',
  'Post Tatame,Publicado/Programado,25/09/2026,"Feed, Institucional",Feed,,,Yes,42,',
].join('\n');

describe('a Notion "Postagens" database (ideas, scripts, schedule)', () => {
  const plan = fromText(POSTAGENS, 'Postagens 0123456789abcdef0123456789abcdef.csv');

  it('finds tags, status, dates, links, checkbox, numbers and the client relation', () => {
    expect(plan.tableName).toBe('Postagens');
    expect(column(plan, 'Título do Conteúdo').type).toBe('text');
    expect(column(plan, 'Status')).toMatchObject({ type: 'select', options: ['Publicado/Programado', 'Ideia'] });
    expect(column(plan, 'Status').optionColors).toEqual({ 'Publicado/Programado': 'green', Ideia: 'yellow' });
    expect(column(plan, 'Data da Publicação').type).toBe('date');
    expect(column(plan, 'Tags 1.1')).toMatchObject({ type: 'multiselect', options: ['Reels', 'Feed', 'Institucional'] });
    expect(column(plan, 'Formato de Conteúdo')).toMatchObject({ type: 'select', options: ['Carrossel', 'Reels', 'Feed'] });
    expect(column(plan, 'Texto').type).toBe('text');
    expect(column(plan, 'Link da publicação').type).toBe('url');
    expect(column(plan, 'Aprovado').type).toBe('boolean');
    expect(column(plan, 'Curtidas').type).toBe('number');
    expect(column(plan, 'Cliente').type).toBe('client');
  });

  it('keeps every date exactly as written', () => {
    const payload = toImportPayload(plan);
    const dateIndex = payload.columns.findIndex((item) => item.label === 'Data da Publicação');
    expect(payload.rows.map((row) => row[dateIndex])).toEqual(['31/08/2026', null, 'September 11, 2026', '15 de setembro de 2026', '25/09/2026']);
  });

  it('keeps multi-line script text intact and tags as arrays', () => {
    const payload = toImportPayload(plan);
    const labels = payload.columns.map((item) => item.label);
    expect(payload.rows[0]![labels.indexOf('Texto')]).toBe('Tela 1: Quantos uniformes?\nTela 2: faça a conta, simples');
    expect(payload.rows[0]![labels.indexOf('Tags 1.1')]).toEqual(['Reels', 'Feed']);
    expect(payload.rows[2]![labels.indexOf('Tags 1.1')]).toEqual(['Feed', 'Institucional']);
  });

  it('casts checkbox and numbers', () => {
    const payload = toImportPayload(plan);
    const labels = payload.columns.map((item) => item.label);
    expect(payload.rows.map((row) => row[labels.indexOf('Aprovado')])).toEqual([true, false, true, false, true]);
    // 1.234 / 2.5 / 980 …: no evidence whether "." is thousands or decimal for 1.234 → the plan defaults to
    // decimal-dot here because 2.5 proves it, and does not flag it.
    expect(payload.rows.map((row) => row[labels.indexOf('Curtidas')])).toEqual([1.234, 980, 2.5, 10, 42]);
    expect(column(plan, 'Curtidas').issues).toEqual([]);
  });

  it('resolves the relation by name, ignoring the Notion link, and asks about the unclear one', () => {
    const clientes = column(plan, 'Cliente');
    expect(clientes.clientNames).toHaveLength(2);
    const [fourS, marcotex] = clientes.clientNames!;
    expect(fourS).toMatchObject({ name: '4s Estamparia', action: 'match', clientId: 'cl_4s', count: 2 });
    // "Marcotex Têxtil" is not "Marcotex": flagged, with the suggestion, defaulting to the safe "create".
    expect(marcotex).toMatchObject({ name: 'Marcotex Têxtil', action: 'create', suggestion: { id: 'cl_marcotex' } });
    expect(clientes.issues).toHaveLength(1);
    expect(clientes.issues[0]).toMatchObject({ kind: 'relation', id: 'unmatched-clients', count: 1 });
  });

  it('lets the user accept the suggestion, which clears the flag', () => {
    const accepted = acceptClientSuggestions(plan, column(plan, 'Cliente').index);
    expect(column(accepted, 'Cliente').issues).toEqual([]);
    const payload = toImportPayload(accepted);
    const clienteIndex = payload.columns.findIndex((item) => item.label === 'Cliente');
    expect(payload.rows.map((row) => row[clienteIndex])).toEqual(['cl_4s', 'cl_4s', 'cl_marcotex', 'cl_marcotex', null]);
    expect(payload.newClients).toEqual([]);
  });

  it('lets the user skip a name or create it', () => {
    const index = column(plan, 'Cliente').index;
    const skipped = setClientAction(plan, index, 'marcotex textil', 'skip');
    expect(toImportPayload(skipped).newClients).toEqual([]);
    expect(summarizePlan(skipped).newClients).toBe(0);
    expect(summarizePlan(plan).newClients).toBe(1);
  });
});

describe('unclear or faulty values are flagged, never dropped silently', () => {
  it('flags a mostly-numeric column and keeps it as text so nothing is lost', () => {
    const plan = fromText('Nome,Qtd\nA,10\nB,20\nC,vinte\nD,40\n');
    expect(column(plan, 'Qtd').type).toBe('text');
  });

  it('when forced to a number, says exactly which values will be emptied', () => {
    const plan = fromText('Nome,Qtd\nA,10\nB,20\nC,vinte\nD,40\n');
    const forced = reanalyzeColumn(plan, column(plan, 'Qtd').index, [], { type: 'number' });
    const qtd = column(forced, 'Qtd');
    expect(qtd.type).toBe('number');
    expect(qtd.issues[0]).toMatchObject({ kind: 'mismatch', count: 1 });
    expect(qtd.issues[0]!.examples).toEqual([{ row: 4, value: 'vinte' }]);
    expect(toImportPayload(forced).rows.map((row) => row[1])).toEqual([10, 20, null, 40]);
    // …and back to whatever detection picked.
    expect(column(resetColumnType(forced, qtd.index, []), 'Qtd').type).toBe('text');
  });

  it('asks when "." could be thousands or decimals, and honors the answer', () => {
    const plan = fromText('Nome,Seguidores\nA,1.234\nB,2.345\nC,987\n');
    const col = column(plan, 'Seguidores');
    expect(col.type).toBe('number');
    expect(col.issues[0]).toMatchObject({ kind: 'ambiguous' });

    const asThousands = toImportPayload(plan).rows.map((row) => row[1]);
    expect(asThousands).toEqual([1234, 2345, 987]);
    const asDecimal = toImportPayload(reanalyzeColumn(plan, col.index, [], { numberLocale: 'en' })).rows.map((row) => row[1]);
    expect(asDecimal).toEqual([1.234, 2.345, 987]);
  });

  it('flags a date column with unreadable values and one with a US-style date', () => {
    const plan = fromText('Nome,Quando\nA,01/09/2026\nB,02/09/2026\nC,09/15/2026\nD,depois\n');
    const quando = column(plan, 'Quando');
    expect(quando.type).toBe('date');
    expect(quando.issues[0]).toMatchObject({ kind: 'mismatch', count: 2 });
    expect(quando.issues[0]!.examples.map((example) => example.value)).toEqual(['09/15/2026', 'depois']);
  });

  it('flags tags detected from commas alone, when only a few cells have several', () => {
    const rows = ['Nome,Area'];
    for (let i = 0; i < 12; i += 1) rows.push(`Item ${i},${i % 2 ? 'Vendas' : 'Suporte'}`);
    rows.push('Item x,"Vendas, Suporte"');
    const area = column(fromText(rows.join('\n')), 'Area');
    expect(area.type).toBe('multiselect');
    expect(area.issues[0]).toMatchObject({ kind: 'ambiguous', count: 1 });
  });

  it('does not treat sparse free text as tags', () => {
    const plan = fromText('Nome,Obs\nA,Prefere a tarde 13h15\nB,prefere sexta\nC,\nD,Antes do dia 30\n');
    expect(column(plan, 'Obs').type).toBe('text');
  });

  it('lets the user switch a tag column back to text', () => {
    const plan = fromText('Nome,Status\nA,Ativa\nB,Ativa\nC,Cancelado\nD,Cancelado\n');
    expect(column(plan, 'Status').type).toBe('select');
    const text = reanalyzeColumn(plan, column(plan, 'Status').index, [], { type: 'text' });
    expect(column(text, 'Status')).toMatchObject({ type: 'text', note: expect.stringContaining('escolhido por você') });
    expect(toImportPayload(text).columns[1]).toEqual({ label: 'Status', type: 'text' });
  });

  it('keeps a code with leading zeros as text', () => {
    const plan = fromText('Nome,CEP\nA,01310\nB,02020\nC,03030\n');
    expect(column(plan, 'CEP').type).toBe('text');
  });
});

describe('a broken file says so instead of failing silently', () => {
  it('reports an empty file and a header-only file as unusable, with a reason', () => {
    expect(fromText('')).toMatchObject({ unusable: true });
    expect(fromText('').warnings[0]!.message).toMatch(/vazio/);
    const headerOnly = fromText('Nome,Idade\n');
    expect(headerOnly.unusable).toBe(true);
    expect(headerOnly.warnings[0]!.message).toMatch(/nenhuma linha de dados/);
  });

  it('warns about rows with the wrong number of cells, naming them', () => {
    const plan = fromText('A,B,C\n1,2,3\n4,5\n6,7,8,9\n');
    expect(plan.warnings).toHaveLength(1);
    expect(plan.warnings[0]!.message).toMatch(/2 linha\(s\)/);
    expect(plan.warnings[0]!.examples).toEqual(['linha 3: 2 colunas (esperado 3)', 'linha 4: 4 colunas (esperado 3)']);
    expect(plan.rows[1]).toEqual(['4', '5', '']);
  });

  it('numbers repeated headers and names blank ones, telling the user', () => {
    const plan = fromText('Nome,Nome,,Nome\nA,B,C,D\n');
    expect(plan.columns.map((item) => item.label)).toEqual(['Nome', 'Nome (2)', 'Coluna 3', 'Nome (3)']);
    expect(plan.warnings.map((warning) => warning.message)).toEqual([
      expect.stringMatching(/sem título/),
      expect.stringMatching(/repetidos/),
    ]);
  });

  it('warns about a cut-off file and about a non-UTF-8 file', () => {
    expect(fromText('A,B\n1,"cortado').warnings.some((warning) => /aspa/.test(warning.message))).toBe(true);
    const latin = buildImportPlan({ fileName: 'x.csv', bytes: new Uint8Array([0x4e, 0x6f, 0x6d, 0x65, 0x0a, 0x41, 0xe7, 0xe3, 0x6f]), clients: [] });
    expect(latin.encoding).toBe('windows-1252');
    expect(latin.rows[0]).toEqual(['Ação']);
    expect(latin.warnings.some((warning) => /Windows-1252/.test(warning.message))).toBe(true);
  });

  it('reads a ;-separated Excel export', () => {
    const plan = fromText('Nome;Valor\nAna;10\nBia;20\n');
    expect(plan.delimiter).toBe(';');
    expect(column(plan, 'Valor').type).toBe('number');
  });

  it('drops blank rows and blank columns without comment', () => {
    const plan = fromText('Nome,Vazia,Idade\nAna,,30\n,,\nBia,,25\n');
    expect(plan.rows).toHaveLength(2);
    expect(plan.warnings).toEqual([]);
    expect(toImportPayload(plan).columns.map((item) => item.label)).toEqual(['Nome', 'Idade']);
  });

  it('honors columns the user turned off', () => {
    const plan = fromText('Nome,Idade\nAna,30\nBia,25\n');
    const off = toggleColumn(plan, column(plan, 'Idade').index, false);
    expect(toImportPayload(off).columns.map((item) => item.label)).toEqual(['Nome']);
    expect(toImportPayload(off).rows).toEqual([['Ana'], ['Bia']]);
  });
});
