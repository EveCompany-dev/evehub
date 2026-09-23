import { prisma, publishLiveEvent } from '@eve/core';
import { strings } from '@eve/ui';
import { z } from 'zod';
import { visibleRoutes } from './navigation';
import { getVisibleTabs } from './permissions';
import { HttpError, type SessionUser } from './session';
import { extractTokens, tokenKey, type ResolvedTokens, type TodoToken } from './todo-tokens';
import type { MentionResult, TodoItemDto, TodoListDetail, TodoListSummary } from './todo-types';

export type { MentionResult, TodoItemDto, TodoListDetail, TodoListSummary } from './todo-types';

/**
 * Personal to-do lists: the one place that reads or writes them. Both the REST
 * routes (/api/todos/*) and the Claude chat tools (lib/chat-tools.ts) go
 * through here, so the ownership rule lives in exactly one spot:
 *
 *   a list belongs to one user; every query filters on that user's id AND
 *   workspace, and anything else is a 404 — for admins too.
 *
 * Deliberately no logActivity() anywhere in this file: to-dos are personal
 * data, which the activity log never records (readme, "Registro de
 * atividades").
 */

export const TODO_TEXT_MAX = 2000;
export const TODO_LIST_NAME_MAX = 80;
export const TODO_ITEMS_PER_CALL_MAX = 50;
const DEFAULT_LIST_NAME = strings.todo.defaultListName;

export const todoTextSchema = z.string().trim().min(1).max(TODO_TEXT_MAX);
export const todoListNameSchema = z.string().trim().min(1).max(TODO_LIST_NAME_MAX);
/** ISO date or date-time; null clears it. */
export const todoDueDateSchema = z.union([z.iso.datetime({ offset: true }), z.iso.date(), z.null()]);

/** Bad input is the caller's mistake (a 400), whether it came from the widget or from Claude — never a 500. */
function valid<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new HttpError(400, strings.errors.invalidPayload);
  return parsed.data;
}

interface TodoItemRow {
  id: string;
  listId: string;
  text: string;
  done: boolean;
  doneAt: Date | null;
  position: number;
  dueDate: Date | null;
  createdAt: Date;
}

export function toItemDto(item: TodoItemRow): TodoItemDto {
  return {
    id: item.id,
    listId: item.listId,
    text: item.text,
    done: item.done,
    doneAt: item.doneAt?.toISOString() ?? null,
    position: item.position,
    dueDate: item.dueDate?.toISOString() ?? null,
    createdAt: item.createdAt.toISOString(),
  };
}

function parseDueDate(value: string | null | undefined): Date | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  valid(todoDueDateSchema, value);
  // A bare date means that day, not midnight UTC of the day before in Brazil.
  const date = new Date(/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T12:00:00` : value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

/** Tells the owner's other open tabs (and the widget, when Claude made the change) to refetch. */
async function notifyChanged(user: SessionUser, listId: string | null): Promise<void> {
  await publishLiveEvent({ type: 'todo:updated', workspaceId: user.workspaceId, userId: user.id, listId });
}

function ownListWhere(user: SessionUser, listId: string) {
  return { id: listId, ownerId: user.id, workspaceId: user.workspaceId };
}

/** The list, if it is this user's. Anyone else — another member, an admin — gets a 404, never a hint that it exists. */
export async function requireOwnList(user: SessionUser, listId: string) {
  const list = await prisma.todoList.findFirst({ where: ownListWhere(user, listId) });
  if (!list) throw new HttpError(404, strings.errors.notFound);
  return list;
}

export async function requireOwnItem(user: SessionUser, itemId: string) {
  const item = await prisma.todoItem.findFirst({
    where: { id: itemId, list: { ownerId: user.id, workspaceId: user.workspaceId } },
  });
  if (!item) throw new HttpError(404, strings.errors.notFound);
  return item;
}

// ---------------------------------------------------------------------------
// Lists
// ---------------------------------------------------------------------------

export async function listTodoLists(user: SessionUser): Promise<TodoListSummary[]> {
  const lists = await prisma.todoList.findMany({
    where: { ownerId: user.id, workspaceId: user.workspaceId },
    orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
    select: { id: true, name: true, position: true },
  });
  if (lists.length === 0) return [];

  const counts = await prisma.todoItem.groupBy({
    by: ['listId', 'done'],
    where: { listId: { in: lists.map((list) => list.id) } },
    _count: { _all: true },
  });
  const countOf = (listId: string, done: boolean) =>
    counts.find((row) => row.listId === listId && row.done === done)?._count._all ?? 0;

  return lists.map((list) => ({ ...list, pendingCount: countOf(list.id, false), doneCount: countOf(list.id, true) }));
}

export async function createTodoList(user: SessionUser, name: string): Promise<TodoListSummary> {
  const clean = valid(todoListNameSchema, name);
  const last = await prisma.todoList.findFirst({
    where: { ownerId: user.id, workspaceId: user.workspaceId },
    orderBy: { position: 'desc' },
    select: { position: true },
  });
  const list = await prisma.todoList.create({
    data: { workspaceId: user.workspaceId, ownerId: user.id, name: clean, position: (last?.position ?? -1) + 1 },
    select: { id: true, name: true, position: true },
  });
  await notifyChanged(user, list.id);
  return { ...list, pendingCount: 0, doneCount: 0 };
}

export async function renameTodoList(user: SessionUser, listId: string, name: string): Promise<{ id: string; name: string }> {
  await requireOwnList(user, listId);
  const list = await prisma.todoList.update({
    where: { id: listId },
    data: { name: valid(todoListNameSchema, name) },
    select: { id: true, name: true },
  });
  await notifyChanged(user, listId);
  return list;
}

/** The user's first list, created as "Minhas tarefas" if they have none — where a task goes when no list was named. */
export async function defaultTodoList(user: SessionUser): Promise<{ id: string; name: string }> {
  const first = await prisma.todoList.findFirst({
    where: { ownerId: user.id, workspaceId: user.workspaceId },
    orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
    select: { id: true, name: true },
  });
  if (first) return first;
  const created = await createTodoList(user, DEFAULT_LIST_NAME);
  return { id: created.id, name: created.name };
}

export async function getTodoList(user: SessionUser, listId: string): Promise<TodoListDetail> {
  const list = await requireOwnList(user, listId);
  const items = await prisma.todoItem.findMany({
    where: { listId },
    orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
  });
  const resolved = await resolveTodoTokens(user, items.flatMap((item) => extractTokens(item.text)));
  return { list: { id: list.id, name: list.name }, items: items.map(toItemDto), resolved };
}

// ---------------------------------------------------------------------------
// Items
// ---------------------------------------------------------------------------

export interface NewTodoItem {
  text: string;
  dueDate?: string | null;
  done?: boolean;
}

/** Appends at the bottom, in order — or, with `at`, inserts starting there (undoing a delete puts the task back where it was). */
export async function addTodoItems(
  user: SessionUser,
  listId: string,
  items: NewTodoItem[],
  at?: number,
): Promise<TodoItemDto[]> {
  await requireOwnList(user, listId);
  const clean = items.slice(0, TODO_ITEMS_PER_CALL_MAX).map((item) => ({
    text: valid(todoTextSchema, item.text),
    dueDate: parseDueDate(item.dueDate ?? null) ?? null,
    done: Boolean(item.done),
  }));
  if (clean.length === 0) return [];

  const created = await prisma.$transaction(async (tx) => {
    let start: number;
    if (at === undefined) {
      const last = await tx.todoItem.findFirst({ where: { listId }, orderBy: { position: 'desc' }, select: { position: true } });
      start = (last?.position ?? -1) + 1;
    } else {
      start = Math.max(0, Math.floor(at));
      await tx.todoItem.updateMany({ where: { listId, position: { gte: start } }, data: { position: { increment: clean.length } } });
    }

    const rows = [];
    for (const [index, item] of clean.entries()) {
      rows.push(
        await tx.todoItem.create({
          data: {
            listId,
            text: item.text,
            dueDate: item.dueDate,
            done: item.done,
            doneAt: item.done ? new Date() : null,
            position: start + index,
          },
        }),
      );
    }
    return rows;
  });

  await notifyChanged(user, listId);
  return created.map(toItemDto);
}

export interface TodoItemPatch {
  text?: string;
  done?: boolean;
  dueDate?: string | null;
}

export async function updateTodoItem(user: SessionUser, itemId: string, patch: TodoItemPatch): Promise<TodoItemDto> {
  const item = await requireOwnItem(user, itemId);
  const dueDate = parseDueDate(patch.dueDate);

  const updated = await prisma.todoItem.update({
    where: { id: item.id },
    data: {
      ...(patch.text !== undefined ? { text: valid(todoTextSchema, patch.text) } : {}),
      ...(patch.done !== undefined && patch.done !== item.done ? { done: patch.done, doneAt: patch.done ? new Date() : null } : {}),
      ...(dueDate !== undefined ? { dueDate } : {}),
    },
  });
  await notifyChanged(user, item.listId);
  return toItemDto(updated);
}

/** Rewrites the manual order. Ids not in this list are ignored; items left out keep their relative order after the given ones. */
export async function reorderTodoItems(user: SessionUser, listId: string, orderedIds: string[]): Promise<void> {
  await requireOwnList(user, listId);
  const items = await prisma.todoItem.findMany({
    where: { listId },
    orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
    select: { id: true },
  });
  const known = new Set(items.map((item) => item.id));
  const given = [...new Set(orderedIds)].filter((id) => known.has(id));
  const rest = items.map((item) => item.id).filter((id) => !given.includes(id));
  const order = [...given, ...rest];

  await prisma.$transaction(order.map((id, position) => prisma.todoItem.update({ where: { id }, data: { position } })));
  await notifyChanged(user, listId);
}

// ---------------------------------------------------------------------------
// Deleting — the widget only. The Claude chat tools never import these: they
// can create, edit and complete tasks, and must not be able to delete any.
// ---------------------------------------------------------------------------

export async function deleteTodoItem(user: SessionUser, itemId: string): Promise<TodoItemDto> {
  const item = await requireOwnItem(user, itemId);
  await prisma.$transaction([
    prisma.todoItem.delete({ where: { id: item.id } }),
    prisma.todoItem.updateMany({ where: { listId: item.listId, position: { gt: item.position } }, data: { position: { decrement: 1 } } }),
  ]);
  await notifyChanged(user, item.listId);
  return toItemDto(item);
}

export async function deleteTodoList(user: SessionUser, listId: string): Promise<void> {
  await requireOwnList(user, listId);
  await prisma.todoList.delete({ where: { id: listId } });
  await notifyChanged(user, listId);
}

// ---------------------------------------------------------------------------
// Mentions (@) and page links (/)
// ---------------------------------------------------------------------------

const MENTION_LIMIT_PER_KIND = 5;

/** Which @-kinds a user may see, following the same tab rules as the pages they live on. */
function mentionableKinds(user: SessionUser): Set<TodoToken['kind']> {
  const tabs = getVisibleTabs(user);
  const kinds = new Set<TodoToken['kind']>(['person']);
  if (tabs.has('jobs')) kinds.add('job');
  if (tabs.has('tables')) {
    kinds.add('client');
    kinds.add('project');
    kinds.add('table');
  }
  return kinds;
}

function visiblePages(user: SessionUser) {
  return visibleRoutes([...getVisibleTabs(user)]);
}

function samePage(href: string, candidate: string): boolean {
  const path = href.split('?')[0];
  return path === candidate;
}

/**
 * "@" searches the workspace's jobs, clients, projects, tables and people;
 * "/" searches the app pages this user can open. Scoped to the workspace and
 * to the user's visible tabs.
 */
export async function searchMentions(user: SessionUser, trigger: '@' | '/', query: string): Promise<MentionResult[]> {
  const q = query.trim().slice(0, 60);

  if (trigger === '/') {
    const needle = q.toLowerCase();
    return visiblePages(user)
      .filter(
        (route) =>
          !needle ||
          route.label.toLowerCase().includes(needle) ||
          route.href.toLowerCase().includes(needle) ||
          route.keywords?.some((keyword) => keyword.includes(needle)),
      )
      .slice(0, 10)
      .map((route) => ({ kind: 'page' as const, id: route.href, label: route.label, hint: route.href }));
  }

  const kinds = mentionableKinds(user);
  const contains = q ? { contains: q, mode: 'insensitive' as const } : undefined;
  const take = MENTION_LIMIT_PER_KIND;
  const ws = user.workspaceId;

  const [jobs, clients, projects, tables, people] = await Promise.all([
    kinds.has('job')
      ? prisma.job.findMany({
          where: { workspaceId: ws, ...(contains ? { title: contains } : {}) },
          orderBy: { updatedAt: 'desc' },
          take,
          select: { id: true, title: true, column: { select: { name: true } } },
        })
      : [],
    kinds.has('client')
      ? prisma.client.findMany({
          where: { workspaceId: ws, ...(contains ? { name: contains } : {}) },
          orderBy: { name: 'asc' },
          take,
          select: { id: true, name: true },
        })
      : [],
    kinds.has('project')
      ? prisma.project.findMany({
          where: { workspaceId: ws, ...(contains ? { title: contains } : {}) },
          orderBy: { updatedAt: 'desc' },
          take,
          select: { id: true, title: true, client: { select: { name: true } } },
        })
      : [],
    kinds.has('table')
      ? prisma.dataTable.findMany({
          where: { workspaceId: ws, ...(contains ? { name: contains } : {}) },
          orderBy: { name: 'asc' },
          take,
          select: { id: true, name: true },
        })
      : [],
    prisma.user.findMany({
      where: {
        workspaceId: ws,
        disabledAt: null,
        deletedAt: null,
        ...(contains ? { OR: [{ name: contains }, { email: contains }] } : {}),
      },
      orderBy: { name: 'asc' },
      take,
      select: { id: true, name: true, email: true },
    }),
  ]);

  return [
    ...jobs.map((job) => ({ kind: 'job' as const, id: job.id, label: job.title, hint: job.column.name })),
    ...clients.map((client) => ({ kind: 'client' as const, id: client.id, label: client.name })),
    ...projects.map((project) => ({ kind: 'project' as const, id: project.id, label: project.title, hint: project.client.name })),
    ...tables.map((table) => ({ kind: 'table' as const, id: table.id, label: table.name })),
    ...people.map((person) => ({ kind: 'person' as const, id: person.id, label: person.name ?? person.email, hint: person.email })),
  ];
}

/**
 * Current label of every token, or null when its target is gone or outside
 * what this user can see — the widget then shows the stored label as plain
 * text instead of a chip that leads nowhere.
 */
export async function resolveTodoTokens(user: SessionUser, tokens: TodoToken[]): Promise<ResolvedTokens> {
  const resolved: ResolvedTokens = {};
  if (tokens.length === 0) return resolved;

  const kinds = mentionableKinds(user);
  const idsOf = (kind: TodoToken['kind']) => [...new Set(tokens.filter((token) => token.kind === kind).map((token) => token.id))];
  const ws = user.workspaceId;

  const lookup = async (kind: TodoToken['kind'], find: (ids: string[]) => Promise<{ id: string; label: string }[]>) => {
    const ids = idsOf(kind);
    if (ids.length === 0) return;
    const found = kinds.has(kind) ? await find(ids) : [];
    const labels = new Map(found.map((row) => [row.id, row.label]));
    for (const id of ids) resolved[tokenKey(kind, id)] = labels.get(id) ?? null;
  };

  await Promise.all([
    lookup('job', async (ids) =>
      (await prisma.job.findMany({ where: { workspaceId: ws, id: { in: ids } }, select: { id: true, title: true } })).map((row) => ({
        id: row.id,
        label: row.title,
      })),
    ),
    lookup('client', async (ids) =>
      (await prisma.client.findMany({ where: { workspaceId: ws, id: { in: ids } }, select: { id: true, name: true } })).map((row) => ({
        id: row.id,
        label: row.name,
      })),
    ),
    lookup('project', async (ids) =>
      (await prisma.project.findMany({ where: { workspaceId: ws, id: { in: ids } }, select: { id: true, title: true } })).map((row) => ({
        id: row.id,
        label: row.title,
      })),
    ),
    lookup('table', async (ids) =>
      (await prisma.dataTable.findMany({ where: { workspaceId: ws, id: { in: ids } }, select: { id: true, name: true } })).map((row) => ({
        id: row.id,
        label: row.name,
      })),
    ),
    lookup('person', async (ids) =>
      (
        await prisma.user.findMany({
          where: { workspaceId: ws, id: { in: ids }, deletedAt: null },
          select: { id: true, name: true, email: true },
        })
      ).map((row) => ({ id: row.id, label: row.name ?? row.email })),
    ),
  ]);

  const pages = visiblePages(user);
  for (const id of idsOf('page')) {
    const route = pages.find((candidate) => samePage(id, candidate.href));
    resolved[tokenKey('page', id)] = route ? route.label : null;
  }

  return resolved;
}
