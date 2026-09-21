import { prisma, type DataColumn } from '@eve/core';

/**
 * The tables every client page is built from — Notion's "Calendário de
 * Conteúdo", "Perfis" and "Referências" databases. One per workspace, created
 * on first use, and otherwise ordinary tables: they show up in Tabelas, take
 * imports and webhooks, and every client's page just filters them by the
 * Cliente column. The column keys below are part of the contract (the client
 * page's shortcut buttons pre-fill them), so they are fixed.
 */
export type SystemTableKind = 'content' | 'profiles' | 'references';

export const SYSTEM_TABLE_KINDS: SystemTableKind[] = ['content', 'profiles', 'references'];

interface SystemTableDefinition {
  name: string;
  columns: DataColumn[];
}

function tag(options: [string, string][]): Pick<DataColumn, 'options' | 'optionColors'> {
  return { options: options.map(([name]) => name), optionColors: Object.fromEntries(options) };
}

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
        ...tag([
          ['Ideia', 'yellow'],
          ['Roteirizando', 'purple'],
          ['Em produção', 'blue'],
          ['Em aprovação', 'orange'],
          ['Publicado/Programado', 'green'],
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
    ],
  },
};

const SUMMARY = { id: true, name: true, columns: true, webhookToken: true, webhookKeyColumn: true } as const;

/** The workspace's table of this kind, created with its standard columns the first time it is asked for. */
export async function ensureSystemTable(workspaceId: string, kind: SystemTableKind) {
  const existing = await prisma.dataTable.findFirst({ where: { workspaceId, kind }, select: SUMMARY });
  if (existing) return existing;

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
