import 'dotenv/config';
import { prisma } from '@eve/core';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

/**
 * Personal to-do lists against the real Postgres, with only the session
 * mocked — same setup as tables-api.db.test.ts (skips itself when no migrated
 * database answers). Two real users in a throwaway workspace: the owner of the
 * lists, and a teammate who is an ADMIN, to prove not even admins get in.
 */

interface TestUser {
  id: string;
  email: string;
  name: string | null;
  image: string | null;
  isOwner: boolean;
  isSocialMedia: boolean;
  roleTabs: string[] | null;
  workspaceId: string;
}

const session = vi.hoisted(() => ({ user: null as null | TestUser }));

vi.mock('./session', () => {
  class HttpError extends Error {
    constructor(
      readonly status: number,
      message: string,
    ) {
      super(message);
      this.name = 'HttpError';
    }
  }
  const requireUser = async () => {
    if (!session.user) throw new HttpError(401, 'unauthenticated');
    return session.user;
  };
  return { HttpError, requireUser, getSessionUser: async () => session.user, requireOwner: requireUser };
});

async function databaseUp(): Promise<boolean> {
  try {
    await prisma.$queryRaw`SELECT 1`;
    await prisma.$queryRaw`SELECT "id" FROM "TodoList" LIMIT 1`;
    return true;
  } catch {
    return false;
  }
}

const dbUp = await databaseUp();

const listsRoute = await import('../app/api/todos/lists/route');
const listRoute = await import('../app/api/todos/lists/[id]/route');
const itemsRoute = await import('../app/api/todos/lists/[id]/items/route');
const orderRoute = await import('../app/api/todos/lists/[id]/order/route');
const itemRoute = await import('../app/api/todos/items/[id]/route');
const mentionsRoute = await import('../app/api/todos/mentions/route');
const { getChatTools, runChatTool } = await import('./chat-tools');

const params = (id: string) => ({ params: Promise.resolve({ id }) });
const json = (method: string, body?: unknown) =>
  body === undefined
    ? new Request('http://test/api/todos', { method })
    : new Request('http://test/api/todos', { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

describe.skipIf(!dbUp)('personal to-do lists', () => {
  let workspaceId = '';
  let otherWorkspaceId = '';
  let owner: TestUser;
  let admin: TestUser;
  let listId = '';
  let itemId = '';
  let foreignJobId = '';

  beforeAll(async () => {
    const stamp = Date.now();
    const workspace = await prisma.workspace.create({ data: { name: `vitest-todos-${stamp}` } });
    const other = await prisma.workspace.create({ data: { name: `vitest-todos-other-${stamp}` } });
    workspaceId = workspace.id;
    otherWorkspaceId = other.id;

    const make = async (email: string, isOwner: boolean): Promise<TestUser> => {
      const row = await prisma.user.create({ data: { workspaceId, email, name: email.split('@')[0], isOwner } });
      return { id: row.id, email, name: row.name, image: null, isOwner, isSocialMedia: false, roleTabs: null, workspaceId };
    };
    owner = await make(`todo-owner-${stamp}@example.com`, false);
    admin = await make(`todo-admin-${stamp}@example.com`, true);

    // A job in ANOTHER workspace, to check a mention can't reveal it.
    const column = await prisma.jobColumn.create({ data: { workspaceId: otherWorkspaceId, name: 'Fazer', position: 0 } });
    const creator = await prisma.user.create({ data: { workspaceId: otherWorkspaceId, email: `todo-x-${stamp}@example.com` } });
    const job = await prisma.job.create({
      data: { workspaceId: otherWorkspaceId, columnId: column.id, position: 0, title: 'Segredo de outro workspace', createdBy: creator.id },
    });
    foreignJobId = job.id;
  });

  afterAll(async () => {
    // Job.createdBy is ON DELETE RESTRICT: the job has to go before its creator does.
    if (foreignJobId) await prisma.job.delete({ where: { id: foreignJobId } }).catch(() => undefined);
    for (const id of [workspaceId, otherWorkspaceId]) {
      if (id) await prisma.workspace.delete({ where: { id } }).catch(() => undefined);
    }
  });

  it('lets the owner create a list and add, edit and complete tasks', async () => {
    session.user = owner;
    const created = await listsRoute.POST(json('POST', { name: 'Semana' }));
    expect(created.status).toBe(201);
    listId = ((await created.json()) as { list: { id: string } }).list.id;

    const first = await itemsRoute.POST(json('POST', { text: 'Primeira' }), params(listId));
    expect(first.status).toBe(201);
    itemId = ((await first.json()) as { item: { id: string } }).item.id;
    await itemsRoute.POST(json('POST', { text: 'Segunda' }), params(listId));

    const patched = await itemRoute.PATCH(json('PATCH', { done: true, text: 'Primeira (feita)' }), params(itemId));
    expect(patched.status).toBe(200);
    const item = ((await patched.json()) as { item: { done: boolean; doneAt: string | null; text: string } }).item;
    expect(item).toMatchObject({ done: true, text: 'Primeira (feita)' });
    expect(item.doneAt).not.toBeNull();

    const detail = (await (await listRoute.GET(json('GET'), params(listId))).json()) as { items: { text: string }[] };
    expect(detail.items.map((row) => row.text)).toEqual(['Primeira (feita)', 'Segunda']);
  });

  it('refuses an empty task instead of saving it', async () => {
    session.user = owner;
    const response = await itemsRoute.POST(json('POST', { text: '   ' }), params(listId));
    expect(response.status).toBe(400);
  });

  it('never lets anyone else — not even an admin — see or touch the list', async () => {
    session.user = admin;

    const lists = (await (await listsRoute.GET()).json()) as { lists: { id: string }[] };
    expect(lists.lists.map((list) => list.id)).not.toContain(listId);

    const attempts: Response[] = [
      await listRoute.GET(json('GET'), params(listId)),
      await listRoute.PATCH(json('PATCH', { name: 'Minha agora' }), params(listId)),
      await listRoute.DELETE(json('DELETE'), params(listId)),
      await itemsRoute.POST(json('POST', { text: 'intrusa' }), params(listId)),
      await orderRoute.PUT(json('PUT', { ids: [itemId] }), params(listId)),
      await itemRoute.PATCH(json('PATCH', { done: false }), params(itemId)),
      await itemRoute.DELETE(json('DELETE'), params(itemId)),
    ];
    // 404, not 403: the list's existence is not confirmed either.
    expect(attempts.map((response) => response.status)).toEqual([404, 404, 404, 404, 404, 404, 404]);

    const untouched = await prisma.todoItem.findMany({ where: { listId }, orderBy: { position: 'asc' } });
    expect(untouched.map((row) => row.text)).toEqual(['Primeira (feita)', 'Segunda']);
    expect((await prisma.todoList.findUniqueOrThrow({ where: { id: listId } })).name).toBe('Semana');
  });

  it('reorders, deletes and undoes a delete back into the same spot', async () => {
    session.user = owner;
    await itemsRoute.POST(json('POST', { text: 'Terceira' }), params(listId));
    const rows = await prisma.todoItem.findMany({ where: { listId }, orderBy: { position: 'asc' } });

    const reordered = await orderRoute.PUT(json('PUT', { ids: [rows[2]!.id, rows[0]!.id, rows[1]!.id] }), params(listId));
    expect(reordered.status).toBe(200);

    const deleted = await itemRoute.DELETE(json('DELETE'), params(rows[0]!.id));
    const snapshot = ((await deleted.json()) as { item: { text: string; done: boolean; position: number } }).item;
    expect(snapshot).toMatchObject({ text: 'Primeira (feita)', done: true, position: 1 });

    const restored = await itemsRoute.POST(json('POST', { text: snapshot.text, done: snapshot.done, position: snapshot.position }), params(listId));
    expect(restored.status).toBe(201);

    const after = await prisma.todoItem.findMany({ where: { listId }, orderBy: { position: 'asc' } });
    expect(after.map((row) => row.text)).toEqual(['Terceira', 'Primeira (feita)', 'Segunda']);
    expect(after.map((row) => row.position)).toEqual([0, 1, 2]);
  });

  it('resolves mentions only inside the workspace', async () => {
    session.user = owner;
    const text = `Ver @[Vazado](job:${foreignJobId}) e /[Jobs](page:/jobs) e /[Log](page:/activity)`;
    await itemsRoute.POST(json('POST', { text }), params(listId));
    const detail = (await (await listRoute.GET(json('GET'), params(listId))).json()) as { resolved: Record<string, string | null> };

    expect(detail.resolved[`job:${foreignJobId}`]).toBeNull();
    expect(detail.resolved['page:/jobs']).toBe('Jobs');
    // The activity log is admin-only: for this user the link is dead text.
    expect(detail.resolved['page:/activity']).toBeNull();

    const search = (await (await mentionsRoute.GET(new Request('http://test/api/todos/mentions?trigger=@&q=Segredo'))).json()) as {
      results: unknown[];
    };
    expect(search.results).toEqual([]);

    const pages = (await (await mentionsRoute.GET(new Request('http://test/api/todos/mentions?trigger=/&q='))).json()) as {
      results: { id: string }[];
    };
    expect(pages.results.map((result) => result.id)).toContain('/jobs');
    expect(pages.results.map((result) => result.id)).not.toContain('/activity');
  });

  describe('through the Claude chat', () => {
    it('offers to-do tools that create, edit and complete — and none that delete', () => {
      const names = getChatTools(owner).map((tool) => tool.name);
      expect(names).toEqual(
        expect.arrayContaining([
          'list_todo_lists',
          'get_todo_list',
          'create_todo_list',
          'add_todo_items',
          'update_todo_item',
          'rename_todo_list',
        ]),
      );
      expect(names.filter((name) => /delete|remove|clear|excluir|apagar/i.test(name))).toEqual([]);
    });

    it('has no delete anywhere in the tool code', () => {
      const source = readFileSync(new URL('./chat-tools.ts', import.meta.url), 'utf8');
      expect(source).not.toMatch(/deleteTodo(Item|List)\s*\(/);
      expect(source).not.toMatch(/\.(delete|deleteMany)\s*\(/);
      expect(source).not.toMatch(/import\s*\{[^}]*deleteTodo/);
    });

    it('creates a list with three tasks and completes one', async () => {
      const created = (await runChatTool(owner, 'create_todo_list', {
        name: 'Lançamento',
        items: ['Briefing', 'Roteiro', 'Aprovação'],
      })) as { list: { id: string }; items: { id: string; text: string }[] };
      expect(created.items.map((item) => item.text)).toEqual(['Briefing', 'Roteiro', 'Aprovação']);

      const done = (await runChatTool(owner, 'update_todo_item', { itemId: created.items[1]!.id, done: true })) as {
        item: { done: boolean };
      };
      expect(done.item.done).toBe(true);

      const lists = (await runChatTool(owner, 'list_todo_lists', {})) as { id: string; pendingCount: number; doneCount: number }[];
      expect(lists.find((list) => list.id === created.list.id)).toMatchObject({ pendingCount: 2, doneCount: 1 });
    });

    it('turns every attempt to delete into something that deletes nothing', async () => {
      const before = await prisma.todoItem.count({ where: { list: { ownerId: owner.id } } });
      const listsBefore = await prisma.todoList.count({ where: { ownerId: owner.id } });

      const results = [
        await runChatTool(owner, 'delete_todo_item', { itemId }),
        await runChatTool(owner, 'delete_todo_list', { listId }),
        // Blanking a task is not a back door to deleting it.
        await runChatTool(owner, 'update_todo_item', { itemId, text: '' }),
        await runChatTool(owner, 'update_todo_item', { itemId, text: '   ' }),
        await runChatTool(owner, 'rename_todo_list', { listId, name: '' }),
      ];
      for (const result of results) expect(result).toHaveProperty('error');

      expect(await prisma.todoItem.count({ where: { list: { ownerId: owner.id } } })).toBe(before);
      expect(await prisma.todoList.count({ where: { ownerId: owner.id } })).toBe(listsBefore);
    });

    it("refuses another user's lists, admin or not", async () => {
      const before = await prisma.todoItem.findUniqueOrThrow({ where: { id: (await prisma.todoItem.findFirstOrThrow({ where: { listId } })).id } });

      const attempts = [
        await runChatTool(admin, 'get_todo_list', { listId }),
        await runChatTool(admin, 'add_todo_items', { listId, items: [{ text: 'intrusa' }] }),
        await runChatTool(admin, 'update_todo_item', { itemId: before.id, done: !before.done, text: 'mexido' }),
        await runChatTool(admin, 'rename_todo_list', { listId, name: 'Do admin' }),
      ];
      for (const result of attempts) expect(result).toEqual({ error: expect.stringMatching(/não encontrada/) });

      const lists = (await runChatTool(admin, 'list_todo_lists', {})) as { id: string }[];
      expect(lists.map((list) => list.id)).not.toContain(listId);

      const after = await prisma.todoItem.findUniqueOrThrow({ where: { id: before.id } });
      expect(after).toMatchObject({ text: before.text, done: before.done });
      expect(await prisma.todoItem.count({ where: { listId, text: 'intrusa' } })).toBe(0);
    });

    it("adds to the user's own first list when no list is named — creating it for someone with none", async () => {
      const added = (await runChatTool(admin, 'add_todo_items', { items: ['Revisar contrato'] })) as { listId: string };
      const list = await prisma.todoList.findUniqueOrThrow({ where: { id: added.listId } });
      expect(list).toMatchObject({ ownerId: admin.id, name: 'Minhas tarefas' });
    });
  });
});
