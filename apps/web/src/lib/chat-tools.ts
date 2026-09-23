import type Anthropic from '@anthropic-ai/sdk';
import { prisma } from '@eve/core';
import { z } from 'zod';
import { canViewFinancial } from './permissions';
import { HttpError, type SessionUser } from './session';
import { plainTodoText } from './todo-tokens';
// Deliberately NOT deleteTodoItem / deleteTodoList: the chat can create, edit
// and complete tasks, never delete them (chat-tools.test.ts checks this).
import {
  addTodoItems,
  createTodoList,
  defaultTodoList,
  getTodoList,
  listTodoLists,
  renameTodoList,
  TODO_ITEMS_PER_CALL_MAX,
  TODO_LIST_NAME_MAX,
  TODO_TEXT_MAX,
  todoDueDateSchema,
  updateTodoItem,
} from './todos';

/**
 * Tools the in-dashboard Claude widget can call, scoped to the calling user's
 * own workspace (never cross-workspace) and their own permissions (financial
 * data only if their Role/isOwner grants the 'financial' tab — see
 * lib/permissions.ts).
 *
 * Everything is read-only except the caller's personal to-do lists (Tarefas):
 * Claude can list them, create lists, add tasks, edit/complete/reopen tasks
 * and rename lists — always the caller's OWN lists, through lib/todos.ts,
 * which answers "not found" for anyone else's. It can never delete a task or
 * a list: there is no tool for it, and nothing here calls a delete.
 *
 * Read coverage is a first slice, not full dashboard coverage: jobs, local
 * Tabelas, Clientes, and (permission-gated) Financeiro. Scheduling posts,
 * automations logs, and team chat are reasonable next additions.
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

  tools.push(...todoTools());

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

/** Today in Brazil, so "amanhã" in a message turns into the right dueDate. */
function todayInBrazil(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
}

const TODO_NO_DELETE =
  'Não existe ferramenta para excluir tarefas nem listas: se o usuário pedir para apagar, explique que isso só pode ser feito por ele no widget Tarefas (clique direito → Excluir, Delete no teclado, ou deslizar para a esquerda no celular). Marcar como concluída NÃO é excluir — não faça isso no lugar de excluir.';

const TODO_TOKENS =
  'O texto de uma tarefa pode ter menções: @[rótulo](job:<id>), @[rótulo](client:<id>), @[rótulo](project:<id>), @[rótulo](table:<id>), @[nome](person:<userId>), e links de página /[rótulo](page:/jobs). Use ids reais obtidos pelas outras ferramentas; preserve as menções existentes ao editar.';

function todoTools(): Anthropic.Tool[] {
  const today = todayInBrazil();
  return [
    {
      name: 'list_todo_lists',
      description:
        'Lista as listas de tarefas PESSOAIS do usuário (widget Tarefas): id, nome, quantas pendentes e quantas concluídas. Só as dele — ninguém mais vê essas listas.',
      input_schema: { type: 'object', properties: {} },
    },
    {
      name: 'get_todo_list',
      description: `Tarefas de uma lista do usuário, em ordem: id, texto, se está concluída e prazo. ${TODO_TOKENS}`,
      input_schema: {
        type: 'object',
        properties: { listId: { type: 'string', description: 'O id da lista, obtido via list_todo_lists.' } },
        required: ['listId'],
      },
    },
    {
      name: 'create_todo_list',
      description: `Cria uma lista de tarefas nova para o usuário, opcionalmente já com tarefas. ${TODO_NO_DELETE}`,
      input_schema: {
        type: 'object',
        properties: {
          name: { type: 'string', description: `Nome da lista (até ${TODO_LIST_NAME_MAX} caracteres).` },
          items: {
            type: 'array',
            description: 'Tarefas iniciais, na ordem.',
            items: { type: 'string' },
            maxItems: TODO_ITEMS_PER_CALL_MAX,
          },
        },
        required: ['name'],
      },
    },
    {
      name: 'add_todo_items',
      description: `Adiciona tarefas ao fim de uma lista do usuário. Sem listId, usa a primeira lista dele (criando "Minhas tarefas" se ele não tiver nenhuma). Hoje é ${today}. ${TODO_TOKENS}`,
      input_schema: {
        type: 'object',
        properties: {
          listId: { type: 'string', description: 'Lista de destino (opcional).' },
          items: {
            type: 'array',
            maxItems: TODO_ITEMS_PER_CALL_MAX,
            items: {
              type: 'object',
              properties: {
                text: { type: 'string', description: `Texto da tarefa (até ${TODO_TEXT_MAX} caracteres).` },
                dueDate: { type: 'string', description: 'Prazo opcional, AAAA-MM-DD.' },
              },
              required: ['text'],
            },
          },
        },
        required: ['items'],
      },
    },
    {
      name: 'update_todo_item',
      description: `Edita uma tarefa do usuário: muda o texto, marca como concluída (done: true) ou pendente (done: false), ou define/limpa o prazo (dueDate AAAA-MM-DD, ou null para tirar). Hoje é ${today}. ${TODO_NO_DELETE}`,
      input_schema: {
        type: 'object',
        properties: {
          itemId: { type: 'string', description: 'O id da tarefa, obtido via get_todo_list.' },
          text: { type: 'string' },
          done: { type: 'boolean' },
          dueDate: { type: ['string', 'null'] },
        },
        required: ['itemId'],
      },
    },
    {
      name: 'rename_todo_list',
      description: 'Renomeia uma lista de tarefas do usuário.',
      input_schema: {
        type: 'object',
        properties: {
          listId: { type: 'string' },
          name: { type: 'string', description: `Novo nome (até ${TODO_LIST_NAME_MAX} caracteres).` },
        },
        required: ['listId', 'name'],
      },
    },
  ];
}

const todoItemInput = z.object({ text: z.string(), dueDate: todoDueDateSchema.optional() });

const todoInputs = {
  get_todo_list: z.object({ listId: z.string().min(1) }),
  create_todo_list: z.object({ name: z.string(), items: z.array(z.string()).max(TODO_ITEMS_PER_CALL_MAX).optional() }),
  add_todo_items: z.object({
    listId: z.string().min(1).optional(),
    items: z.array(z.union([todoItemInput, z.string()])).min(1).max(TODO_ITEMS_PER_CALL_MAX),
  }),
  update_todo_item: z.object({
    itemId: z.string().min(1),
    text: z.string().optional(),
    done: z.boolean().optional(),
    dueDate: todoDueDateSchema.optional(),
  }),
  rename_todo_list: z.object({ listId: z.string().min(1), name: z.string() }),
};

function todoItemView(item: { id: string; text: string; done: boolean; dueDate: string | null }) {
  return { id: item.id, text: item.text, readable: plainTodoText(item.text), done: item.done, dueDate: item.dueDate };
}

/** Runs one to-do tool. Every path goes through lib/todos.ts, which only ever touches `user`'s own lists. */
async function runTodoTool(user: SessionUser, name: string, input: Record<string, unknown>): Promise<unknown> {
  const invalid = { error: 'Parâmetros inválidos para a ferramenta.' };
  try {
    switch (name) {
      case 'list_todo_lists':
        return await listTodoLists(user);

      case 'get_todo_list': {
        const parsed = todoInputs.get_todo_list.safeParse(input);
        if (!parsed.success) return invalid;
        const detail = await getTodoList(user, parsed.data.listId);
        return { list: detail.list, items: detail.items.map(todoItemView) };
      }

      case 'create_todo_list': {
        const parsed = todoInputs.create_todo_list.safeParse(input);
        if (!parsed.success) return invalid;
        const list = await createTodoList(user, parsed.data.name);
        const items = parsed.data.items?.length ? await addTodoItems(user, list.id, parsed.data.items.map((text) => ({ text }))) : [];
        return { list: { id: list.id, name: list.name }, items: items.map(todoItemView) };
      }

      case 'add_todo_items': {
        const parsed = todoInputs.add_todo_items.safeParse(input);
        if (!parsed.success) return invalid;
        const listId = parsed.data.listId ?? (await defaultTodoList(user)).id;
        const items = await addTodoItems(
          user,
          listId,
          parsed.data.items.map((item) => (typeof item === 'string' ? { text: item } : item)),
        );
        return { listId, items: items.map(todoItemView) };
      }

      case 'update_todo_item': {
        const parsed = todoInputs.update_todo_item.safeParse(input);
        if (!parsed.success) return invalid;
        const { itemId, ...patch } = parsed.data;
        if (Object.keys(patch).length === 0) return { error: 'Nada para alterar.' };
        return { item: todoItemView(await updateTodoItem(user, itemId, patch)) };
      }

      case 'rename_todo_list': {
        const parsed = todoInputs.rename_todo_list.safeParse(input);
        if (!parsed.success) return invalid;
        return { list: await renameTodoList(user, parsed.data.listId, parsed.data.name) };
      }

      default:
        return { error: `Ferramenta desconhecida: ${name}` };
    }
  } catch (error) {
    if (error instanceof HttpError) {
      if (error.status === 404) return { error: 'Lista ou tarefa não encontrada (só as listas do próprio usuário são acessíveis).' };
      if (error.status === 400) return { error: 'Valor inválido (texto vazio ou longo demais, nome vazio, ou data fora do formato AAAA-MM-DD).' };
      return { error: error.message };
    }
    throw error;
  }
}

const TODO_TOOL_NAMES = new Set(['list_todo_lists', 'get_todo_list', 'create_todo_list', 'add_todo_items', 'update_todo_item', 'rename_todo_list']);

function clampLimit(value: unknown, fallback: number, max: number): number {
  const num = typeof value === 'number' ? Math.floor(value) : fallback;
  return Math.min(Math.max(num, 1), max);
}

/** Executes one tool call. Every branch scopes its own Prisma query to `user.workspaceId` — an id in `input` is never trusted as proof of access. */
export async function runChatTool(user: SessionUser, name: string, input: Record<string, unknown>): Promise<unknown> {
  if (TODO_TOOL_NAMES.has(name)) return runTodoTool(user, name, input ?? {});

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
