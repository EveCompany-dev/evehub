import 'dotenv/config';
import { prisma } from '@eve/core';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { buildImportPlan, setClientAction, toImportPayload } from './table-import/plan';

/**
 * Integration tests: the real route handlers against the real Postgres, with
 * only the session mocked. They skip themselves when no database answers, so
 * `pnpm test` stays hermetic on a machine without one — but run in CI (where a
 * migrated Postgres is provided) and on a dev box with `pnpm services:up`.
 * Everything happens in a throwaway workspace that is deleted afterwards.
 */

const session = vi.hoisted(() => ({
  user: null as null | {
    id: string;
    email: string;
    name: string | null;
    image: string | null;
    isOwner: boolean;
    isSocialMedia: boolean;
    roleTabs: string[] | null;
    workspaceId: string;
  },
}));

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
    // The new tables/columns this feature needs — an un-migrated DB skips instead of failing confusingly.
    await prisma.$queryRaw`SELECT "color", "icon", "logoUrl" FROM "Client" LIMIT 1`;
    return true;
  } catch {
    return false;
  }
}

const dbUp = await databaseUp();

const importRoute = await import('../app/api/tables/import/route');
const tablesRoute = await import('../app/api/tables/[id]/route');
const rowsRoute = await import('../app/api/tables/[id]/rows/route');
const clientsRoute = await import('../app/api/scheduling/clients/route');
const clientRoute = await import('../app/api/scheduling/clients/[id]/route');
const linkedRoute = await import('../app/api/clients/[id]/linked-rows/route');

const params = (id: string) => ({ params: Promise.resolve({ id }) });

function post(url: string, body: unknown): Request {
  return new Request(`http://test${url}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
}
function patch(url: string, body: unknown): Request {
  return new Request(`http://test${url}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
}

interface TableBody {
  table: { id: string; name: string; columns: { key: string; label: string; type: string; options?: string[]; optionColors?: Record<string, string> }[] };
  rowCount: number;
  createdClients: number;
}

describe.skipIf(!dbUp)('tables API against Postgres', () => {
  let workspaceId = '';

  beforeAll(async () => {
    const workspace = await prisma.workspace.create({ data: { name: `vitest-tables-${Date.now()}` } });
    workspaceId = workspace.id;
    session.user = {
      id: 'vitest-user',
      email: 'vitest@example.com',
      name: 'Vitest',
      image: null,
      isOwner: true,
      isSocialMedia: false,
      roleTabs: null,
      workspaceId,
    };
  });

  afterAll(async () => {
    if (workspaceId) await prisma.workspace.delete({ where: { id: workspaceId } }).catch(() => undefined);
  });

  const asMember = (allowed: boolean) => {
    session.user = { ...session.user!, isOwner: allowed };
  };

  async function importPlan(csv: string, name = 'Postagens 0123456789abcdef0123456789abcdef.csv', mutate?: (plan: ReturnType<typeof buildImportPlan>) => ReturnType<typeof buildImportPlan>) {
    const clients = (await prisma.client.findMany({ where: { workspaceId } })).map((client) => ({ id: client.id, label: client.name }));
    let plan = buildImportPlan({ fileName: name, bytes: new TextEncoder().encode(csv), clients });
    if (mutate) plan = mutate(plan);
    return toImportPayload(plan);
  }

  const CSV = [
    'Título do Conteúdo,Status,Data da Publicação,Tags 1.1,Texto,Aprovado,Curtidas,Cliente',
    'Carrossel Quantos Uniformes,Publicado/Programado,31/08/2026,"Reels, Feed","Tela 1\nTela 2, com vírgula",Yes,1.234,4s Estamparia (https://www.notion.so/4s-1122754f44e88009aebaea47add27dc7)',
    'Reels Dr. Uniforme,Ideia,,Reels,,No,980,4s Estamparia (https://www.notion.so/4s-1122754f44e88009aebaea47add27dc7)',
    'Post Família,Publicado/Programado,"September 11, 2026","Feed, Institucional",Legenda,Yes,2.5,Marcotex',
    'Post Tatame,Ideia,25/09/2026,"Feed, Institucional",,No,10,',
  ].join('\n');

  it('imports a Notion-style CSV as a new table: typed columns, tag options with colors, rows in order', async () => {
    const payload = await importPlan(CSV);
    const response = await importRoute.POST(post('/api/tables/import', payload));
    expect(response.status).toBe(201);
    const body = (await response.json()) as TableBody;

    expect(body.rowCount).toBe(4);
    expect(body.createdClients).toBe(2);
    expect(body.table.name).toBe('Postagens');
    const byLabel = Object.fromEntries(body.table.columns.map((column) => [column.label, column]));
    expect(byLabel['Status']).toMatchObject({ type: 'select', options: ['Publicado/Programado', 'Ideia'], optionColors: { 'Publicado/Programado': 'green', Ideia: 'yellow' } });
    expect(byLabel['Tags 1.1']).toMatchObject({ type: 'multiselect', options: ['Reels', 'Feed', 'Institucional'] });
    expect(byLabel['Data da Publicação']!.type).toBe('date');
    expect(byLabel['Cliente']!.type).toBe('client');

    const rowsResponse = await rowsRoute.GET(new Request('http://test'), params(body.table.id));
    const { rows } = (await rowsResponse.json()) as { rows: { data: Record<string, unknown> }[] };
    const key = (label: string) => byLabel[label]!.key;
    expect(rows.map((row) => row.data[key('Título do Conteúdo')])).toEqual([
      'Carrossel Quantos Uniformes',
      'Reels Dr. Uniforme',
      'Post Família',
      'Post Tatame',
    ]);
    // Dates stay exactly as written; tags are arrays; long text keeps its newline and comma.
    expect(rows.map((row) => row.data[key('Data da Publicação')])).toEqual(['31/08/2026', undefined, 'September 11, 2026', '25/09/2026']);
    expect(rows[0]!.data[key('Tags 1.1')]).toEqual(['Reels', 'Feed']);
    expect(rows[0]!.data[key('Texto')]).toBe('Tela 1\nTela 2, com vírgula');
    expect(rows[0]!.data[key('Aprovado')]).toBe(true);
    expect(rows[1]!.data[key('Aprovado')]).toBe(false);
    expect(rows[0]!.data[key('Curtidas')]).toBe(1.234);

    // The two relation names were created once each and both rows of "4s Estamparia" share one client.
    const clients = await prisma.client.findMany({ where: { workspaceId }, orderBy: { name: 'asc' } });
    expect(clients.map((client) => client.name)).toEqual(['4s Estamparia', 'Marcotex']);
    expect(rows[0]!.data[key('Cliente')]).toBe(clients[0]!.id);
    expect(rows[1]!.data[key('Cliente')]).toBe(clients[0]!.id);
    expect(rows[2]!.data[key('Cliente')]).toBe(clients[1]!.id);
    expect(rows[3]!.data[key('Cliente')]).toBeUndefined();
  });

  it('a second import matches the now-existing clients instead of duplicating them', async () => {
    const payload = await importPlan(CSV, 'Postagens (2).csv');
    expect(payload.newClients).toEqual([]);
    const response = await importRoute.POST(post('/api/tables/import', payload));
    expect(response.status).toBe(201);
    expect(((await response.json()) as TableBody).createdClients).toBe(0);
    expect(await prisma.client.count({ where: { workspaceId } })).toBe(2);
  });

  it('even a stale plan that still says "create" does not duplicate an existing client', async () => {
    const payload = {
      name: 'Stale',
      columns: [{ label: 'Cliente', type: 'client' as const }],
      rows: [['new:4S ESTAMPARIA']],
      newClients: ['4S ESTAMPARIA'],
    };
    const response = await importRoute.POST(post('/api/tables/import', payload));
    expect(((await response.json()) as TableBody).createdClients).toBe(0);
    expect(await prisma.client.count({ where: { workspaceId } })).toBe(2);
  });

  it('honors "use the suggested client" and "skip"', async () => {
    const clients = await prisma.client.findMany({ where: { workspaceId } });
    const marcotex = clients.find((client) => client.name === 'Marcotex')!;
    const payload = await importPlan('Título,Cliente\nA,Marcotex Têxtil\nB,Dicasa Móveis\n', 'Escolhas.csv', (plan) => {
      const column = plan.columns.find((item) => item.label === 'Cliente')!;
      const withUse = setClientAction(plan, column.index, 'marcotex textil', 'use', marcotex.id);
      return setClientAction(withUse, column.index, 'dicasa moveis', 'skip');
    });
    const response = await importRoute.POST(post('/api/tables/import', payload));
    const body = (await response.json()) as TableBody;
    expect(body.createdClients).toBe(0);
    const { rows } = (await (await rowsRoute.GET(new Request('http://test'), params(body.table.id))).json()) as { rows: { data: Record<string, unknown> }[] };
    const clienteKey = body.table.columns.find((column) => column.label === 'Cliente')!.key;
    expect(rows[0]!.data[clienteKey]).toBe(marcotex.id);
    expect(rows[1]!.data[clienteKey]).toBeUndefined();
  });

  it('refuses to create clients for someone without the Clientes permission — and creates no table', async () => {
    const tablesBefore = await prisma.dataTable.count({ where: { workspaceId } });
    asMember(false);
    try {
      const payload = await importPlan('Título,Cliente\nA,Cliente Novo Inexistente\n', 'Sem permissao.csv');
      expect(payload.newClients).toEqual(['Cliente Novo Inexistente']);
      const response = await importRoute.POST(post('/api/tables/import', payload));
      expect(response.status).toBe(403);
      expect(((await response.json()) as { error: string }).error).toMatch(/criar 1 cliente/);
    } finally {
      asMember(true);
    }
    expect(await prisma.dataTable.count({ where: { workspaceId } })).toBe(tablesBefore);
    expect(await prisma.client.count({ where: { workspaceId, name: 'Cliente Novo Inexistente' } })).toBe(0);
  });

  it('folds a value the plan did not list into the column options, and drops client ids from other workspaces', async () => {
    const response = await importRoute.POST(
      post('/api/tables/import', {
        name: 'Orfaos',
        columns: [
          { label: 'Status', type: 'select', options: ['Ideia'] },
          { label: 'Tags', type: 'multiselect', options: [] },
          { label: 'Cliente', type: 'client' },
        ],
        rows: [['Em análise', ['a', 'b'], 'cliente-de-outro-workspace']],
      }),
    );
    expect(response.status).toBe(201);
    const body = (await response.json()) as TableBody;
    const [status, tags] = body.table.columns;
    expect(status!.options).toEqual(['Ideia', 'Em análise']);
    expect(tags!.options).toEqual(['a', 'b']);
    const { rows } = (await (await rowsRoute.GET(new Request('http://test'), params(body.table.id))).json()) as { rows: { data: Record<string, unknown> }[] };
    expect(rows[0]!.data['cliente']).toBeUndefined();
  });

  it('rejects malformed imports with a readable message', async () => {
    const tooWide = await importRoute.POST(post('/api/tables/import', { name: 'X', columns: [{ label: 'A', type: 'text' }], rows: [['1', '2']] }));
    expect(tooWide.status).toBe(400);
    expect(((await tooWide.json()) as { error: string }).error).toMatch(/linha 1 tem mais células/);

    const badType = await importRoute.POST(post('/api/tables/import', { name: 'X', columns: [{ label: 'A', type: 'wat' }], rows: [] }));
    expect(badType.status).toBe(400);

    const noColumns = await importRoute.POST(post('/api/tables/import', { name: 'X', columns: [], rows: [] }));
    expect(noColumns.status).toBe(400);
  });

  it('imports only into the caller\'s workspace', async () => {
    const other = await prisma.workspace.create({ data: { name: `vitest-other-${Date.now()}` } });
    try {
      const response = await importRoute.POST(post('/api/tables/import', { name: 'Minha', columns: [{ label: 'A', type: 'text' }], rows: [['x']] }));
      const body = (await response.json()) as TableBody;
      expect((await prisma.dataTable.findUnique({ where: { id: body.table.id } }))!.workspaceId).toBe(workspaceId);
      expect(await prisma.dataTable.count({ where: { workspaceId: other.id } })).toBe(0);
    } finally {
      await prisma.workspace.delete({ where: { id: other.id } });
    }
  });

  it('keeps tag colors when a column is edited afterwards (PATCH), and accepts the new types', async () => {
    const created = await importRoute.POST(post('/api/tables/import', { name: 'Editar', columns: [{ label: 'Nome', type: 'text' }], rows: [['a']] }));
    const { table } = (await created.json()) as TableBody;

    const response = await tablesRoute.PATCH(
      patch(`/api/tables/${table.id}`, {
        columns: [
          { key: table.columns[0]!.key, label: 'Nome', type: 'text' },
          { label: 'Tags', type: 'multiselect', options: ['Reels', 'Feed'], optionColors: { Reels: 'purple', Feed: 'orange' } },
          { label: 'Link', type: 'url' },
        ],
      }),
      params(table.id),
    );
    expect(response.status).toBe(200);
    const updated = ((await response.json()) as { table: TableBody['table'] }).table;
    expect(updated.columns.map((column) => [column.key, column.type])).toEqual([
      ['nome', 'text'],
      ['tags', 'multiselect'],
      ['link', 'url'],
    ]);
    expect(updated.columns[1]!.optionColors).toEqual({ Reels: 'purple', Feed: 'orange' });

    // Row edits accept an array for the tag column.
    const rowsResponse = await rowsRoute.GET(new Request('http://test'), params(table.id));
    const { rows } = (await rowsResponse.json()) as { rows: { id: string }[] };
    const rowRoute = await import('../app/api/tables/[id]/rows/[rowId]/route');
    const saved = await rowRoute.PATCH(patch(`/api/tables/${table.id}/rows/${rows[0]!.id}`, { data: { tags: ['Reels', 'Feed'] } }), {
      params: Promise.resolve({ id: table.id, rowId: rows[0]!.id }),
    });
    expect(saved.status).toBe(200);
    expect(((await saved.json()) as { row: { data: Record<string, unknown> } }).row.data['tags']).toEqual(['Reels', 'Feed']);
  });

  it('stores a client\'s brand identity and rejects a bad color', async () => {
    const created = await clientsRoute.POST(post('/api/scheduling/clients', { name: 'Marca Teste', color: '#2f7fd1', icon: '🧵', logoUrl: '/uploads/client-logos/x.png' }));
    expect(created.status).toBe(201);
    const { client } = (await created.json()) as { client: { id: string; color: string; icon: string; logoUrl: string } };
    expect(client).toMatchObject({ color: '#2f7fd1', icon: '🧵', logoUrl: '/uploads/client-logos/x.png' });

    const list = (await (await clientsRoute.GET()).json()) as { clients: { id: string; label: string; color: string | null; logoUrl: string | null }[] };
    expect(list.clients.find((item) => item.id === client.id)).toMatchObject({ label: 'Marca Teste', color: '#2f7fd1', logoUrl: '/uploads/client-logos/x.png' });

    const cleared = await clientRoute.PATCH(patch(`/api/scheduling/clients/${client.id}`, { color: null, logoUrl: null }), params(client.id));
    expect(((await cleared.json()) as { client: { color: string | null; logoUrl: string | null; icon: string } }).client).toMatchObject({ color: null, logoUrl: null, icon: '🧵' });

    for (const bad of [{ color: 'red' }, { color: '#12345' }, { logoUrl: 'https://evil.example/x.png' }]) {
      const response = await clientRoute.PATCH(patch(`/api/scheduling/clients/${client.id}`, bad), params(client.id));
      expect(response.status, JSON.stringify(bad)).toBe(400);
    }
  });

  it('lists, on a client, the table rows that point at it (the back-link of the relation)', async () => {
    const clients = await prisma.client.findMany({ where: { workspaceId } });
    const fourS = clients.find((client) => client.name === '4s Estamparia')!;
    const response = await linkedRoute.GET(new Request('http://test'), params(fourS.id));
    const { groups } = (await response.json()) as { groups: { table: { name: string }; count: number; rows: { title: string; tags: { name: string; color: string | null }[] }[] }[] };

    const postagens = groups.filter((group) => group.table.name === 'Postagens');
    expect(postagens.length).toBeGreaterThanOrEqual(1);
    const first = postagens[0]!;
    expect(first.count).toBe(2);
    expect(first.rows.map((row) => row.title)).toEqual(['Carrossel Quantos Uniformes', 'Reels Dr. Uniforme']);
    expect(first.rows[0]!.tags).toEqual([{ name: 'Publicado/Programado', color: 'green' }]);
  });

  it('404s for a client of another workspace', async () => {
    const other = await prisma.workspace.create({ data: { name: `vitest-foreign-${Date.now()}` } });
    const foreign = await prisma.client.create({ data: { workspaceId: other.id, name: 'Alheio' } });
    try {
      const response = await linkedRoute.GET(new Request('http://test'), params(foreign.id));
      expect(response.status).toBe(404);
    } finally {
      await prisma.workspace.delete({ where: { id: other.id } });
    }
  });
});
