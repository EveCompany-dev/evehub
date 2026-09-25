import { CONTENT_STATUS, contentDate, prisma, type DataColumn, type Prisma } from '@eve/core';
import { parseLooseDate, toIsoDate } from './table-dates';

/**
 * The tables every client page is built from — Notion's "Calendário de
 * Conteúdo", "Perfis" and "Referências" databases. One per workspace, created
 * on first use, and otherwise ordinary tables: they show up in Tabelas, take
 * imports and webhooks, and every client's page just filters them by the
 * Cliente column. The column keys below are part of the contract (the client
 * page's shortcut buttons pre-fill them), so they are fixed.
 */
export type SystemTableKind = 'content' | 'profiles' | 'references' | 'traffic';

export const SYSTEM_TABLE_KINDS: SystemTableKind[] = ['content', 'profiles', 'references', 'traffic'];

interface SystemTableDefinition {
  name: string;
  columns: DataColumn[];
}

function tag(options: [string, string][]): Pick<DataColumn, 'options' | 'optionColors'> {
  return { options: options.map(([name]) => name), optionColors: Object.fromEntries(options) };
}

const AUTOMATIC_STATUSES: [string, string][] = [
  [CONTENT_STATUS.scheduled, 'pink'],
  [CONTENT_STATUS.published, 'green'],
  [CONTENT_STATUS.failed, 'red'],
];

/**
 * Until 2026-09-22 this was one option: nothing could tell "scheduled" from
 * "went live", so the team kept one tag for both. Eve Hub now knows (the
 * worker only calls a post published once Meta confirms it), so the option
 * is split — see splitRetiredStatus.
 */
export const RETIRED_STATUS = 'Publicado/Programado';

const CHANNELS: [string, string][] = [
  ['Instagram', 'pink'],
  ['Facebook', 'blue'],
  ['TikTok', 'gray'],
  ['YouTube', 'red'],
  ['LinkedIn', 'blue'],
];

export const SYSTEM_TABLES: Record<SystemTableKind, SystemTableDefinition> = {
  content: {
    name: 'Calendário de Conteúdo',
    columns: [
      { key: 'titulo', label: 'Título do Conteúdo', type: 'text' },
      { key: 'cliente', label: 'Cliente', type: 'client' },
      { key: 'canal', label: 'Canal', type: 'select', ...tag(CHANNELS) },
      {
        key: 'status',
        label: 'Status',
        type: 'select',
        // The last three are set by Eve Hub itself as posts are scheduled,
        // confirmed by Meta, or fail (see @eve/core's content-posts).
        ...tag([
          ['Ideia', 'yellow'],
          ['Roteirizando', 'purple'],
          ['Em produção', 'blue'],
          ['Em aprovação', 'orange'],
          ...AUTOMATIC_STATUSES,
        ]),
      },
      {
        key: 'formato',
        label: 'Formato de Conteúdo',
        type: 'select',
        ...tag([
          ['Reels', 'purple'],
          ['Carrossel', 'pink'],
          ['Feed', 'orange'],
          ['Stories', 'blue'],
        ]),
      },
      { key: 'data', label: 'Data da Publicação', type: 'date' },
      { key: 'link', label: 'Link da publicação', type: 'url' },
      { key: 'imagem', label: 'Imagem', type: 'image' },
      { key: 'texto', label: 'Roteiro / legenda', type: 'text' },
    ],
  },
  profiles: {
    name: 'Perfis sociais',
    columns: [
      { key: 'perfil', label: 'Perfil', type: 'text' },
      { key: 'cliente', label: 'Cliente', type: 'client' },
      { key: 'rede', label: 'Rede', type: 'select', ...tag([...CHANNELS, ['Site', 'green']]) },
      { key: 'link', label: 'Link', type: 'url' },
    ],
  },
  references: {
    name: 'Referências',
    columns: [
      { key: 'referencia', label: 'Referência', type: 'text' },
      { key: 'cliente', label: 'Cliente', type: 'client' },
      {
        key: 'status',
        label: 'Status',
        type: 'select',
        ...tag([
          ['a ver', 'blue'],
          ['vista', 'green'],
        ]),
      },
      {
        key: 'formato',
        label: 'Formato',
        type: 'select',
        ...tag([
          ['Reels', 'purple'],
          ['Carrossel', 'pink'],
          ['Feed', 'orange'],
        ]),
      },
      { key: 'link', label: 'Link da referência', type: 'url' },
      { key: 'imagem', label: 'Imagem', type: 'image' },
    ],
  },
  traffic: {
    name: 'Tráfego Pago',
    columns: [
      { key: 'campanha', label: 'Campanha', type: 'text' },
      { key: 'cliente', label: 'Cliente', type: 'client' },
      {
        key: 'plataforma',
        label: 'Plataforma',
        type: 'select',
        ...tag([
          ['Meta Ads', 'blue'],
          ['Google Ads', 'green'],
          ['TikTok Ads', 'gray'],
          ['LinkedIn Ads', 'purple'],
        ]),
      },
      {
        key: 'objetivo',
        label: 'Objetivo',
        type: 'select',
        ...tag([
          ['Reconhecimento', 'purple'],
          ['Tráfego', 'blue'],
          ['Engajamento', 'pink'],
          ['Leads', 'orange'],
          ['Vendas', 'green'],
          ['Mensagens', 'yellow'],
        ]),
      },
      {
        key: 'status',
        label: 'Status',
        type: 'select',
        ...tag([
          ['Planejada', 'yellow'],
          ['Ativa', 'green'],
          ['Pausada', 'orange'],
          ['Encerrada', 'gray'],
        ]),
      },
      { key: 'inicio', label: 'Início', type: 'date' },
      { key: 'fim', label: 'Fim', type: 'date' },
      { key: 'orcamento', label: 'Orçamento (R$)', type: 'number' },
      { key: 'investido', label: 'Investido (R$)', type: 'number' },
      { key: 'resultados', label: 'Resultados', type: 'text' },
      { key: 'link', label: 'Link da campanha', type: 'url' },
      { key: 'observacoes', label: 'Observações', type: 'text' },
    ],
  },
};

const SUMMARY = { id: true, name: true, columns: true, webhookToken: true, webhookKeyColumn: true } as const;

type SummaryRow = NonNullable<Awaited<ReturnType<typeof findSummary>>>;
const findSummary = (workspaceId: string, kind: SystemTableKind) => prisma.dataTable.findFirst({ where: { workspaceId, kind }, select: SUMMARY });

/**
 * A table created by an earlier version lacks columns added since. Appends
 * just those (listed in BACKFILL) when missing; everything else the team
 * renamed, removed or added on their own stays exactly as they left it.
 */
const BACKFILL: Record<SystemTableKind, string[]> = { content: ['imagem'], profiles: [], references: ['imagem'], traffic: [] };

async function addMissingColumns(table: SummaryRow, kind: SystemTableKind): Promise<SummaryRow> {
  const current = Array.isArray(table.columns) ? (table.columns as unknown as DataColumn[]) : [];
  const have = new Set(current.map((column) => column.key));
  const missing = SYSTEM_TABLES[kind].columns.filter((column) => BACKFILL[kind].includes(column.key) && !have.has(column.key));
  if (missing.length === 0) return table;
  return prisma.dataTable.update({ where: { id: table.id }, data: { columns: [...current, ...missing] as unknown as object }, select: SUMMARY });
}

/**
 * The content Status column with the options Eve Hub sets by itself, or null
 * when it already has them. The retired "Publicado/Programado" gives its
 * place to Programado + Publicado; Falhou goes at the end. Options the team
 * added or recolored stay as they are.
 */
export function splitRetiredStatus(columns: DataColumn[]): DataColumn[] | null {
  let changed = false;
  const next = columns.map((column) => {
    if (column.key !== 'status' || column.type !== 'select') return column;
    const current = column.options ?? [];
    const options = current.flatMap((option) => (option === RETIRED_STATUS ? [CONTENT_STATUS.scheduled, CONTENT_STATUS.published] : [option]));
    for (const [name] of AUTOMATIC_STATUSES) if (!options.includes(name)) options.push(name);
    const unique = [...new Set(options)];
    if (unique.length === current.length && unique.every((option, index) => option === current[index])) return column;

    changed = true;
    const optionColors = { ...column.optionColors };
    delete optionColors[RETIRED_STATUS];
    for (const [name, color] of AUTOMATIC_STATUSES) optionColors[name] ??= color;
    return { ...column, options: unique, optionColors };
  });
  return changed ? next : null;
}

/** What a row tagged "Publicado/Programado" really is: past its date, published; otherwise (or no readable date) scheduled. */
export function statusAfterSplit(dateValue: unknown, today: string): string {
  const date = typeof dateValue === 'string' ? parseLooseDate(dateValue) : null;
  return date && toIsoDate(date) < today ? CONTENT_STATUS.published : CONTENT_STATUS.scheduled;
}

/** One-time, on the first read after the split shipped: new options, and every retired tag re-tagged by its date. */
async function upgradeContentStatuses(table: SummaryRow): Promise<SummaryRow> {
  const current = Array.isArray(table.columns) ? (table.columns as unknown as DataColumn[]) : [];
  const columns = splitRetiredStatus(current);
  if (!columns) return table;

  const today = contentDate(new Date());
  return prisma.$transaction(async (tx) => {
    const rows = await tx.dataTableRow.findMany({ where: { tableId: table.id, data: { path: ['status'], equals: RETIRED_STATUS } }, select: { id: true, data: true } });
    for (const row of rows) {
      const data = row.data as Record<string, unknown>;
      await tx.dataTableRow.update({ where: { id: row.id }, data: { data: { ...data, status: statusAfterSplit(data.data, today) } as Prisma.InputJsonValue } });
    }
    return tx.dataTable.update({ where: { id: table.id }, data: { columns: columns as unknown as object }, select: SUMMARY });
  });
}

/** The workspace's table of this kind, created with its standard columns the first time it is asked for. */
export async function ensureSystemTable(workspaceId: string, kind: SystemTableKind) {
  const existing = await prisma.dataTable.findFirst({ where: { workspaceId, kind }, select: SUMMARY });
  if (existing) {
    const complete = await addMissingColumns(existing, kind);
    return kind === 'content' ? upgradeContentStatuses(complete) : complete;
  }

  const definition = SYSTEM_TABLES[kind];
  try {
    return await prisma.dataTable.create({
      data: { workspaceId, kind, name: definition.name, columns: definition.columns as unknown as object },
      select: SUMMARY,
    });
  } catch (error) {
    // Two requests raced to create it: the unique (workspaceId, kind) index let one win.
    const winner = await prisma.dataTable.findFirst({ where: { workspaceId, kind }, select: SUMMARY });
    if (winner) return winner;
    throw error;
  }
}
