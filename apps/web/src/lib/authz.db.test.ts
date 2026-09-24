import 'dotenv/config';
import { prisma } from '@eve/core';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

/**
 * Regression tests for the authorization findings of the 2026-09-18 security
 * audit — the real route handlers against the real Postgres, with only the
 * session mocked.
 *
 * Same shape as tables-api.db.test.ts: they skip when no database answers, so
 * `pnpm test` stays hermetic on a machine without one, and run in CI (which
 * provides a migrated Postgres) or locally after `pnpm services:up`.
 *
 * Each of these reproduced a real defect. Before the fix every "refuses"
 * expectation below returned 2xx.
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
  // The real one, not a stub: these tests are about workspace scoping, so
  // faking it away would test nothing.
  const requireInstance = async (instanceId: string, user: { workspaceId: string }) => {
    const { prisma: db } = await import('@eve/core');
    const instance = await db.connectorInstance.findUnique({ where: { id: instanceId } });
    if (!instance || instance.workspaceId !== user.workspaceId) throw new HttpError(404, 'not found');
    return instance;
  };
  return {
    HttpError,
    requireUser,
    requireOwner: requireUser,
    getSessionUser: async () => session.user,
    requireInstance,
  };
});

async function databaseUp(): Promise<boolean> {
  try {
    await prisma.$queryRaw`SELECT 1`;
    await prisma.$queryRaw`SELECT "clientId" FROM "ConnectorInstance" LIMIT 1`;
    return true;
  } catch {
    return false;
  }
}

const dbUp = await databaseUp();

const timeEntryRoute = await import('../app/api/jobs/[id]/time-entries/[entryId]/route');
const webhookRoute = await import('../app/api/tables/[id]/webhook/route');
const instanceRoute = await import('../app/api/instances/[id]/route');

function patch(url: string, body: unknown): Request {
  return new Request(`http://test${url}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe.skipIf(!dbUp)('authorization regressions', () => {
  let workspaceId = '';
  let ownerId = '';
  let memberId = '';
  let otherMemberId = '';
  let jobId = '';

  const asOwner = () => {
    session.user = {
      id: ownerId,
      email: 'owner@vitest.invalid',
      name: 'Owner',
      image: null,
      isOwner: true,
      isSocialMedia: false,
      roleTabs: null,
      workspaceId,
    };
  };

  const asMember = () => {
    session.user = {
      id: memberId,
      email: 'member@vitest.invalid',
      name: 'Member',
      image: null,
      isOwner: false,
      isSocialMedia: false,
      roleTabs: null,
      workspaceId,
    };
  };

  beforeAll(async () => {
    const stamp = Date.now();
    const workspace = await prisma.workspace.create({ data: { name: `vitest-authz-${stamp}` } });
    workspaceId = workspace.id;

    const owner = await prisma.user.create({
      data: { workspaceId, email: `owner-${stamp}@vitest.invalid`, name: 'Owner', isOwner: true },
    });
    const member = await prisma.user.create({
      data: { workspaceId, email: `member-${stamp}@vitest.invalid`, name: 'Member' },
    });
    const other = await prisma.user.create({
      data: { workspaceId, email: `other-${stamp}@vitest.invalid`, name: 'Other' },
    });
    ownerId = owner.id;
    memberId = member.id;
    otherMemberId = other.id;

    const column = await prisma.jobColumn.create({ data: { workspaceId, name: `A fazer ${stamp}`, position: 0 } });
    const job = await prisma.job.create({
      data: { workspaceId, columnId: column.id, position: 0, title: 'Job de teste', createdBy: owner.id },
    });
    jobId = job.id;

    asOwner();
  });

  afterAll(async () => {
    if (workspaceId) await prisma.workspace.delete({ where: { id: workspaceId } }).catch(() => undefined);
  });

  describe('time entries are personal (H-4)', () => {
    it("refuses to edit or delete a colleague's entry", async () => {
      // The entry belongs to `otherMemberId`; `member` is a colleague in the
      // same workspace, which used to be enough because the route only checked
      // that the entry belonged to the job in the URL.
      const entry = await prisma.timeEntry.create({ data: { jobId, userId: otherMemberId } });
      asMember();

      const context = { params: Promise.resolve({ id: jobId, entryId: entry.id }) };
      const patched = await timeEntryRoute.PATCH(patch(`/api/jobs/${jobId}/time-entries/${entry.id}`, { stop: true }), context);
      expect(patched.status).toBe(403);

      const deleted = await timeEntryRoute.DELETE(new Request('http://test', { method: 'DELETE' }), {
        params: Promise.resolve({ id: jobId, entryId: entry.id }),
      });
      expect(deleted.status).toBe(403);

      // Still there, and still running.
      const after = await prisma.timeEntry.findUnique({ where: { id: entry.id } });
      expect(after).not.toBeNull();
      expect(after!.endedAt).toBeNull();
    });

    it("lets an admin correct a colleague's entry", async () => {
      const entry = await prisma.timeEntry.create({ data: { jobId, userId: otherMemberId } });
      asOwner();

      const response = await timeEntryRoute.PATCH(patch(`/api/jobs/${jobId}/time-entries/${entry.id}`, { stop: true }), {
        params: Promise.resolve({ id: jobId, entryId: entry.id }),
      });
      expect(response.status).toBe(200);
    });

    it('still lets you stop your own entry', async () => {
      const entry = await prisma.timeEntry.create({ data: { jobId, userId: memberId } });
      asMember();

      const response = await timeEntryRoute.PATCH(patch(`/api/jobs/${jobId}/time-entries/${entry.id}`, { stop: true }), {
        params: Promise.resolve({ id: jobId, entryId: entry.id }),
      });
      expect(response.status).toBe(200);

      const after = await prisma.timeEntry.findUnique({ where: { id: entry.id } });
      expect(after!.endedAt).not.toBeNull();
    });

    it("refuses an entry that belongs to a different job, even if it is yours", async () => {
      const otherColumn = await prisma.jobColumn.create({
        data: { workspaceId, name: `Outra ${Date.now()}`, position: 1 },
      });
      const otherJob = await prisma.job.create({
        data: { workspaceId, columnId: otherColumn.id, position: 0, title: 'Outro job', createdBy: ownerId },
      });
      const entry = await prisma.timeEntry.create({ data: { jobId: otherJob.id, userId: memberId } });
      asMember();

      const response = await timeEntryRoute.PATCH(patch('/api/x', { stop: true }), {
        params: Promise.resolve({ id: jobId, entryId: entry.id }),
      });
      expect(response.status).toBe(404);
    });
  });

  describe('table webhook token is a credential (M-3)', () => {
    let tableId = '';

    beforeAll(async () => {
      const table = await prisma.dataTable.create({
        data: { workspaceId, name: `Tabela ${Date.now()}`, columns: [{ key: 'nome', label: 'Nome', type: 'text' }] },
      });
      tableId = table.id;
    });

    it('refuses a non-owner rotating or disabling it', async () => {
      asMember();
      const context = () => ({ params: Promise.resolve({ id: tableId }) });

      const rotated = await webhookRoute.POST(new Request('http://test', { method: 'POST' }), context());
      expect(rotated.status).toBe(403);

      const disabled = await webhookRoute.DELETE(new Request('http://test', { method: 'DELETE' }), context());
      expect(disabled.status).toBe(403);

      const after = await prisma.dataTable.findUnique({ where: { id: tableId } });
      expect(after!.webhookToken).toBeNull();
    });

    it('lets an owner rotate it', async () => {
      asOwner();
      const response = await webhookRoute.POST(new Request('http://test', { method: 'POST' }), {
        params: Promise.resolve({ id: tableId }),
      });
      expect(response.status).toBe(200);

      const after = await prisma.dataTable.findUnique({ where: { id: tableId } });
      expect(after!.webhookToken).not.toBeNull();
    });
  });

  describe('a credentialed connector’s config is owner-only (M-1)', () => {
    let instanceId = '';

    beforeAll(async () => {
      const instance = await prisma.connectorInstance.create({
        data: { workspaceId, connectorId: 'meta', label: 'Meta de teste', config: { pageId: '1234567890' } },
      });
      instanceId = instance.id;
    });

    it('refuses a non-owner re-pointing it', async () => {
      // Writing the secret was already owner-only; re-pointing what the secret
      // acts on was not, so a member could aim the owner's Page token at a Page
      // of their choosing and trigger a sync.
      asMember();
      const response = await instanceRoute.PATCH(patch(`/api/instances/${instanceId}`, { config: { pageId: '9999999999' } }), {
        params: Promise.resolve({ id: instanceId }),
      });
      expect(response.status).toBe(403);

      const after = await prisma.connectorInstance.findUnique({ where: { id: instanceId } });
      expect((after!.config as { pageId?: string }).pageId).toBe('1234567890');
    });

    it('lets an owner change it', async () => {
      asOwner();
      const response = await instanceRoute.PATCH(patch(`/api/instances/${instanceId}`, { config: { pageId: '9999999999' } }), {
        params: Promise.resolve({ id: instanceId }),
      });
      expect(response.status).toBe(200);
    });

    it('rejects a pageId carrying a path or query, whoever sends it (M-2)', async () => {
      // `min(1)` used to accept this, and it is interpolated straight into the
      // Graph API path — so the caller chose the endpoint and its parameters.
      asOwner();
      const response = await instanceRoute.PATCH(
        patch(`/api/instances/${instanceId}`, { config: { pageId: 'me/accounts?fields=access_token&x=' } }),
        { params: Promise.resolve({ id: instanceId }) },
      );
      expect(response.status).toBe(400);
    });

    it('still lets a non-owner rename it', async () => {
      // The gate is on `config`, not on the label — renaming a widget is not a
      // credential operation.
      asMember();
      const response = await instanceRoute.PATCH(patch(`/api/instances/${instanceId}`, { label: 'Renomeado' }), {
        params: Promise.resolve({ id: instanceId }),
      });
      expect(response.status).toBe(200);
    });
  });
});
