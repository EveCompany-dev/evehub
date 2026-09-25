import 'dotenv/config';
import { prisma } from '@eve/core';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Jobs: who can conclude, delete, reopen and restore, and what each list
 * shows — the real route handlers against the real Postgres, with only the
 * session mocked. Skips without a database, like the other *.db.test.ts.
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

vi.mock('./session', async () => {
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
  return { HttpError, requireUser, getSessionUser: async () => session.user };
});

async function databaseUp(): Promise<boolean> {
  try {
    await prisma.$queryRaw`SELECT 1`;
    await prisma.$queryRaw`SELECT "deletedAt", "responsibleId" FROM "Job" LIMIT 1`;
    return true;
  } catch {
    return false;
  }
}

const dbUp = await databaseUp();

const jobsRoute = await import('../app/api/jobs/route');
const jobRoute = await import('../app/api/jobs/[id]/route');
const restoreRoute = await import('../app/api/jobs/[id]/restore/route');
const systemTableRoute = await import('../app/api/system-tables/[kind]/route');

const DAY = 24 * 60 * 60 * 1000;

function json(method: string, url: string, body?: unknown): Request {
  return new Request(`http://test${url}`, {
    method,
    ...(body !== undefined ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}),
  });
}

const params = (id: string) => ({ params: Promise.resolve({ id }) });

async function listIds(view?: string): Promise<{ status: number; ids: string[] }> {
  const response = await jobsRoute.GET(json('GET', view ? `/api/jobs?view=${view}` : '/api/jobs'));
  if (!response.ok) return { status: response.status, ids: [] };
  const body = (await response.json()) as { jobs: { id: string }[] };
  return { status: response.status, ids: body.jobs.map((job) => job.id) };
}

describe.skipIf(!dbUp)('jobs lifecycle', () => {
  let workspaceId = '';
  let adminId = '';
  let memberId = '';
  let outsiderId = '';
  let columnId = '';
  let clientA = '';
  let clientB = '';
  let clientC = '';

  const as = (id: string, isOwner: boolean) => {
    session.user = { id, email: `${id}@vitest.invalid`, name: null, image: null, isOwner, isSocialMedia: false, roleTabs: null, workspaceId };
  };
  const asAdmin = () => as(adminId, true);
  const asMember = () => as(memberId, false);
  const asOutsider = () => as(outsiderId, false);

  /** A fresh job on the board, created by the admin with `memberId` among the envolvidos. */
  const makeJob = async (title = 'Job') => {
    const top = await prisma.job.aggregate({ where: { columnId }, _max: { position: true } });
    return prisma.job.create({
      data: {
        workspaceId,
        columnId,
        position: (top._max.position ?? -1) + 1,
        title,
        createdBy: adminId,
        collaborators: { create: [{ userId: memberId }] },
      },
    });
  };

  beforeAll(async () => {
    const stamp = Date.now();
    const workspace = await prisma.workspace.create({ data: { name: `vitest-jobs-${stamp}` } });
    workspaceId = workspace.id;
    adminId = (await prisma.user.create({ data: { workspaceId, email: `admin-${stamp}@vitest.invalid`, isOwner: true } })).id;
    memberId = (await prisma.user.create({ data: { workspaceId, email: `member-${stamp}@vitest.invalid` } })).id;
    outsiderId = (await prisma.user.create({ data: { workspaceId, email: `outsider-${stamp}@vitest.invalid` } })).id;
    columnId = (await prisma.jobColumn.create({ data: { workspaceId, name: `A fazer ${stamp}`, position: 0 } })).id;
    clientA = (await prisma.client.create({ data: { workspaceId, name: `Cliente A ${stamp}` } })).id;
    clientB = (await prisma.client.create({ data: { workspaceId, name: `Cliente B ${stamp}` } })).id;
    clientC = (await prisma.client.create({ data: { workspaceId, name: `Cliente C ${stamp}` } })).id;
  });

  beforeEach(() => asAdmin());

  afterAll(async () => {
    if (workspaceId) await prisma.workspace.delete({ where: { id: workspaceId } }).catch(() => undefined);
  });

  describe('Adicionar job', () => {
    it('creates one job per client when duplicating, with responsável and envolvidos on each', async () => {
      asMember();
      const response = await jobsRoute.POST(
        json('POST', '/api/jobs', {
          title: 'Campanha de outubro',
          clientId: clientA,
          duplicateClientIds: [clientB, clientC, clientA],
          responsibleId: outsiderId,
          collaboratorUserIds: [memberId],
          description: 'Briefing completo',
          dueDate: new Date('2026-10-01T12:00:00Z').toISOString(),
        }),
      );
      expect(response.status).toBe(201);
      const body = (await response.json()) as { jobs: { id: string; clientId: string; responsibleId: string; description: string; collaborators: { userId: string }[] }[] };
      expect(body.jobs.map((job) => job.clientId).sort()).toEqual([clientA, clientB, clientC].sort());
      for (const job of body.jobs) {
        expect(job.responsibleId).toBe(outsiderId);
        expect(job.description).toBe('Briefing completo');
        expect(job.collaborators.map((collaborator) => collaborator.userId)).toEqual([memberId]);
      }
    });

    it('goes to the first column when none is given', async () => {
      const response = await jobsRoute.POST(json('POST', '/api/jobs', { title: 'Sem coluna' }));
      expect(response.status).toBe(201);
      const body = (await response.json()) as { job: { columnId: string } };
      expect(body.job.columnId).toBe(columnId);
    });

    it('refuses a client from another workspace', async () => {
      const other = await prisma.workspace.create({ data: { name: `vitest-jobs-other-${Date.now()}` } });
      try {
        const foreign = await prisma.client.create({ data: { workspaceId: other.id, name: 'Outro' } });
        const response = await jobsRoute.POST(json('POST', '/api/jobs', { title: 'X', duplicateClientIds: [foreign.id] }));
        expect(response.status).toBe(400);
      } finally {
        await prisma.workspace.delete({ where: { id: other.id } });
      }
    });
  });

  describe('Concluir', () => {
    it('lets an envolvido conclude; the job leaves the board and only admins see it', async () => {
      const job = await makeJob('Para concluir');
      asMember();
      const response = await jobRoute.PATCH(json('PATCH', `/api/jobs/${job.id}`, { concluded: true }), params(job.id));
      expect(response.status).toBe(200);

      expect((await listIds()).ids).not.toContain(job.id);
      expect((await jobRoute.GET(json('GET', `/api/jobs/${job.id}`), params(job.id))).status).toBe(404);
      expect((await listIds('concluded')).status).toBe(403);

      asAdmin();
      expect((await listIds('concluded')).ids).toContain(job.id);
      expect((await jobRoute.GET(json('GET', `/api/jobs/${job.id}`), params(job.id))).status).toBe(200);
    });

    it('refuses someone who is not one of the job’s people', async () => {
      const job = await makeJob('Não é meu');
      asOutsider();
      const response = await jobRoute.PATCH(json('PATCH', `/api/jobs/${job.id}`, { concluded: true }), params(job.id));
      expect(response.status).toBe(403);
      expect((await prisma.job.findUnique({ where: { id: job.id } }))!.concludedAt).toBeNull();
    });

    it('only an admin reopens, and the job comes back to the board', async () => {
      const job = await makeJob('Reabrir');
      await prisma.job.update({ where: { id: job.id }, data: { concludedAt: new Date(), concludedBy: memberId } });

      asMember();
      expect((await jobRoute.PATCH(json('PATCH', `/api/jobs/${job.id}`, { concluded: false }), params(job.id))).status).toBe(404);

      asAdmin();
      expect((await jobRoute.PATCH(json('PATCH', `/api/jobs/${job.id}`, { concluded: false }), params(job.id))).status).toBe(200);
      expect((await listIds()).ids).toContain(job.id);
    });

    it('a concluded job in a column does not break moving jobs into it', async () => {
      const hidden = await makeJob('Concluído na coluna');
      await prisma.job.update({ where: { id: hidden.id }, data: { concludedAt: new Date() } });
      const moving = await makeJob('Movendo');
      const onBoard = (await listIds()).ids.filter((id) => id !== moving.id);
      const order = [moving.id, ...(await prisma.job.findMany({ where: { id: { in: onBoard }, columnId }, select: { id: true } })).map((row) => row.id)];

      asMember();
      const response = await jobRoute.PATCH(json('PATCH', `/api/jobs/${moving.id}`, { move: { columnId, order } }), params(moving.id));
      expect(response.status).toBe(200);
    });
  });

  describe('Apagar and the trash', () => {
    it('only admins delete; a member gets 403 and the job stays', async () => {
      const job = await makeJob('Não apague');
      asMember();
      expect((await jobRoute.DELETE(json('DELETE', `/api/jobs/${job.id}`), params(job.id))).status).toBe(403);
      expect((await prisma.job.findUnique({ where: { id: job.id } }))!.deletedAt).toBeNull();
      expect((await listIds('trash')).status).toBe(403);
    });

    it('deleting moves the job to the trash, hidden from everyone, restorable by an admin', async () => {
      const job = await makeJob('Para a lixeira');
      await prisma.timeEntry.create({ data: { jobId: job.id, userId: memberId, endedAt: new Date() } });

      expect((await jobRoute.DELETE(json('DELETE', `/api/jobs/${job.id}`), params(job.id))).status).toBe(200);
      const trashed = await prisma.job.findUnique({ where: { id: job.id } });
      expect(trashed!.deletedAt).not.toBeNull();
      expect(await prisma.timeEntry.count({ where: { jobId: job.id } })).toBe(1);

      expect((await listIds()).ids).not.toContain(job.id);
      expect((await jobRoute.GET(json('GET', `/api/jobs/${job.id}`), params(job.id))).status).toBe(404);
      expect((await listIds('trash')).ids).toContain(job.id);

      asMember();
      expect((await restoreRoute.POST(json('POST', `/api/jobs/${job.id}/restore`), params(job.id))).status).toBe(403);

      asAdmin();
      expect((await restoreRoute.POST(json('POST', `/api/jobs/${job.id}/restore`), params(job.id))).status).toBe(200);
      expect((await listIds()).ids).toContain(job.id);
    });

    it('removes jobs for good after 7 days in the trash', async () => {
      const old = await makeJob('Velho');
      const recent = await makeJob('Recente');
      await prisma.job.update({ where: { id: old.id }, data: { deletedAt: new Date(Date.now() - 8 * DAY), deletedBy: adminId } });
      await prisma.job.update({ where: { id: recent.id }, data: { deletedAt: new Date(Date.now() - 6 * DAY), deletedBy: adminId } });

      const trash = await listIds('trash');
      expect(trash.ids).toContain(recent.id);
      expect(trash.ids).not.toContain(old.id);
      expect(await prisma.job.findUnique({ where: { id: old.id } })).toBeNull();
      expect(await prisma.job.findUnique({ where: { id: recent.id } })).not.toBeNull();
    });

    it('apagar de vez only works on a job already in the trash', async () => {
      const job = await makeJob('De vez');
      expect((await jobRoute.DELETE(json('DELETE', `/api/jobs/${job.id}?permanent=1`), params(job.id))).status).toBe(409);
      await jobRoute.DELETE(json('DELETE', `/api/jobs/${job.id}`), params(job.id));
      expect((await jobRoute.DELETE(json('DELETE', `/api/jobs/${job.id}?permanent=1`), params(job.id))).status).toBe(200);
      expect(await prisma.job.findUnique({ where: { id: job.id } })).toBeNull();
    });
  });

  describe('Responsável', () => {
    it('can be set and cleared, and must belong to the workspace', async () => {
      const job = await makeJob('Responsável');
      const set = await jobRoute.PATCH(json('PATCH', `/api/jobs/${job.id}`, { responsibleId: memberId }), params(job.id));
      expect(set.status).toBe(200);
      expect((await prisma.job.findUnique({ where: { id: job.id } }))!.responsibleId).toBe(memberId);

      const bogus = await jobRoute.PATCH(json('PATCH', `/api/jobs/${job.id}`, { responsibleId: 'nope' }), params(job.id));
      expect(bogus.status).toBe(400);

      await jobRoute.PATCH(json('PATCH', `/api/jobs/${job.id}`, { responsibleId: null }), params(job.id));
      expect((await prisma.job.findUnique({ where: { id: job.id } }))!.responsibleId).toBeNull();
    });
  });

  describe('Tráfego Pago', () => {
    it('is created on first use with its standard columns', async () => {
      const response = await systemTableRoute.GET(json('GET', '/api/system-tables/traffic'), { params: Promise.resolve({ kind: 'traffic' }) });
      expect(response.status).toBe(200);
      const body = (await response.json()) as { table: { name: string; columns: { key: string; type: string }[] } };
      expect(body.table.name).toBe('Tráfego Pago');
      expect(body.table.columns.find((column) => column.key === 'cliente')?.type).toBe('client');
      expect(body.table.columns.map((column) => column.key)).toEqual(expect.arrayContaining(['campanha', 'plataforma', 'orcamento', 'investido']));
    });
  });
});
