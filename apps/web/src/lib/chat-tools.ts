import type Anthropic from '@anthropic-ai/sdk';
import { prisma } from '@eve/core';
import { canViewFinancial } from './permissions';
import type { SessionUser } from './session';

/**
 * Read-only tools the in-dashboard Claude widget can call, scoped to the
 * calling user's own workspace (never cross-workspace) and their own
 * permissions (financial data only if their Role/isOwner grants the
 * 'financial' tab — see lib/permissions.ts). This is intentionally a first
 * slice, not full dashboard coverage: jobs, local Tabelas, Clientes, and
 * (permission-gated) Financeiro. Scheduling posts, automations logs, and
 * team chat are reasonable next additions, not included here.
 */
export function getChatTools(user: SessionUser): Anthropic.Tool[] {
  const tools: Anthropic.Tool[] = [
    {
      name: 'list_jobs',
      description:
        'Lista os jobs (quadro kanban) do workspace: titulo, coluna atual, data de entrega, se esta marcado importante, e colaboradores. Use para responder perguntas sobre o que esta em andamento, atrasado, ou quem esta em cada job.',
      input_schema: {
        type: 'object',
        properties: { limit: { type: 'number', description: 'Máximo de jobs a retornar (padrão e máximo 50).' } },
      },
    },
    {
      name: 'get_job',
      description: 'Detalhe completo de um job especifico: descricao, tarefas (com status) e colaboradores.',
      input_schema: {
        type: 'object',
        properties: { jobId: { type: 'string', description: 'O id do job, obtido via list_jobs.' } },
        required: ['jobId'],
      },
    },
    {
      name: 'list_tables',
      description: 'Lista as Tabelas locais do workspace (nome, id e colunas configuradas).',
      input_schema: { type: 'object', properties: {} },
    },
    {
      name: 'get_table_rows',
      description: 'Le as linhas de uma Tabela local especifica pelo id, obtido via list_tables.',
      input_schema: {
        type: 'object',
        properties: {
          tableId: { type: 'string' },
          limit: { type: 'number', description: 'Máximo de linhas a retornar (padrão 50, máximo 200).' },
        },
        required: ['tableId'],
      },
    },
    {
      name: 'list_clients',
      description: 'Lista os clientes locais cadastrados (Clientes) — nome e notas.',
      input_schema: { type: 'object', properties: {} },
    },
  ];

  if (canViewFinancial(user)) {
    tools.push({
      name: 'list_financial_entries',
      description: 'Lista lançamentos financeiros (entradas e saídas) recentes do workspace, com valor, cliente e job associados.',
      input_schema: {
        type: 'object',
        properties: { limit: { type: 'number', description: 'Máximo de lançamentos a retornar (padrão 30, máximo 100).' } },
      },
    });
  }

  return tools;
}

function clampLimit(value: unknown, fallback: number, max: number): number {
  const num = typeof value === 'number' ? Math.floor(value) : fallback;
  return Math.min(Math.max(num, 1), max);
}

/** Executes one tool call. Every branch scopes its own Prisma query to `user.workspaceId` — an id in `input` is never trusted as proof of access. */
export async function runChatTool(user: SessionUser, name: string, input: Record<string, unknown>): Promise<unknown> {
  switch (name) {
    case 'list_jobs': {
      const jobs = await prisma.job.findMany({
        where: { workspaceId: user.workspaceId },
        orderBy: [{ columnId: 'asc' }, { position: 'asc' }],
        take: clampLimit(input.limit, 30, 50),
        include: {
          column: { select: { name: true } },
          collaborators: { include: { user: { select: { name: true, email: true } } } },
        },
      });
      return jobs.map((job) => ({
        id: job.id,
        title: job.title,
        column: job.column.name,
        dueDate: job.dueDate,
        important: job.important,
        collaborators: job.collaborators.map((collaborator) => collaborator.user.name ?? collaborator.user.email),
      }));
    }

    case 'get_job': {
      const jobId = typeof input.jobId === 'string' ? input.jobId : '';
      const job = await prisma.job.findUnique({
        where: { id: jobId },
        include: { tasks: true, column: { select: { name: true } } },
      });
      if (!job || job.workspaceId !== user.workspaceId) return { error: 'Job não encontrado.' };
      return {
        id: job.id,
        title: job.title,
        description: job.description,
        column: job.column.name,
        dueDate: job.dueDate,
        important: job.important,
        tasks: job.tasks.map((task) => ({ title: task.title, done: task.done, important: task.important })),
      };
    }

    case 'list_tables': {
      const tables = await prisma.dataTable.findMany({
        where: { workspaceId: user.workspaceId },
        select: { id: true, name: true, columns: true },
      });
      return tables;
    }

    case 'get_table_rows': {
      const tableId = typeof input.tableId === 'string' ? input.tableId : '';
      const table = await prisma.dataTable.findUnique({ where: { id: tableId } });
      if (!table || table.workspaceId !== user.workspaceId) return { error: 'Tabela não encontrada.' };
      const rows = await prisma.dataTableRow.findMany({ where: { tableId }, take: clampLimit(input.limit, 50, 200) });
      return { columns: table.columns, rows: rows.map((row) => row.data) };
    }

    case 'list_clients': {
      const clients = await prisma.client.findMany({
        where: { workspaceId: user.workspaceId },
        select: { id: true, name: true, notes: true },
      });
      return clients;
    }

    case 'list_financial_entries': {
      if (!canViewFinancial(user)) return { error: 'Sem permissão para ver dados financeiros.' };
      const entries = await prisma.financialEntry.findMany({
        where: { workspaceId: user.workspaceId },
        orderBy: { date: 'desc' },
        take: clampLimit(input.limit, 30, 100),
        include: { client: { select: { name: true } }, job: { select: { title: true } } },
      });
      return entries.map((entry) => ({
        type: entry.type,
        description: entry.description,
        amountCents: entry.amountCents,
        date: entry.date,
        client: entry.client?.name ?? null,
        job: entry.job?.title ?? null,
      }));
    }

    default:
      return { error: `Ferramenta desconhecida: ${name}` };
  }
}
