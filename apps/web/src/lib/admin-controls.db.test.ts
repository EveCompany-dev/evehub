import 'dotenv/config';
import { hashPassword, prisma, verifyPassword } from '@eve/core';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

/**
 * Integration tests for the admin model, account deletion, password recovery
 * and the activity log: the real route handlers against the real Postgres,
 * with only the session mocked. Self-skips when no migrated database answers
 * (same contract as tables-api.db.test.ts). Everything lives in a throwaway
 * workspace that is removed afterwards.
 */

type TestUser = {
  id: string;
  email: string;
  name: string | null;
  image: string | null;
  isOwner: boolean;
  isSocialMedia: boolean;
  roleTabs: string[] | null;
  workspaceId: string;
};

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
    // An un-migrated DB skips instead of failing confusingly.
    await prisma.$queryRaw`SELECT "id" FROM "ActivityLog" LIMIT 1`;
    await prisma.$queryRaw`SELECT "deletedAt" FROM "User" LIMIT 1`;
    return true;
  } catch {
    return false;
  }
}

const dbUp = await databaseUp();

const usersRoute = await import('../app/api/users/route');
const userRoute = await import('../app/api/users/[id]/route');
const issueLinkRoute = await import('../app/api/users/[id]/password-reset/route');
const pendingRoute = await import('../app/api/password-resets/route');
const requestRoute = await import('../app/api/password-reset/request/route');
const completeRoute = await import('../app/api/password-reset/complete/route');
const activityRoute = await import('../app/api/activity/route');
const profileRoute = await import('../app/api/profile/route');
const jobsRoute = await import('../app/api/jobs/route');
const dmRoute = await import('../app/api/direct-messages/conversations/[id]/messages/route');

const params = (id: string) => ({ params: Promise.resolve({ id }) });

function json(method: string, url: string, body?: unknown): Request {
  return new Request(`http://test${url}`, {
    method,
    headers: { 'Content-Type': 'application/json', 'x-forwarded-for': `10.0.0.${Math.floor(Math.random() * 250)}` },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

describe.skipIf(!dbUp)('admin controls against Postgres', () => {
  const stamp = Date.now();
  let workspaceId = '';
  let admin: TestUser;
  let alice: TestUser; // has work in the workspace, gets deleted
  let bruno: TestUser; // forgets the password
  let jobId = '';
  let conversationId = '';

  const as = (user: TestUser) => {
    session.user = user;
  };

  beforeAll(async () => {
    const workspace = await prisma.workspace.create({ data: { name: `vitest-admin-${stamp}` } });
    workspaceId = workspace.id;

    const make = async (name: string, isOwner: boolean): Promise<TestUser> => {
      const row = await prisma.user.create({
        data: {
          workspaceId,
          name,
          email: `${name.toLowerCase()}-${stamp}@vitest.invalid`,
          isOwner,
          passwordHash: await hashPassword('senha-antiga-123'),
          image: '/uploads/avatars/vitest-does-not-exist.png',
        },
      });
      return { id: row.id, email: row.email, name, image: null, isOwner, isSocialMedia: false, roleTabs: null, workspaceId };
    };

    admin = await make('Admin', true);
    alice = await make('Alice', false);
    bruno = await make('Bruno', false);

    // Alice leaves work behind: a job, a comment, a team-chat message and a DM.
    const column = await prisma.jobColumn.create({ data: { workspaceId, name: `Col ${stamp}`, position: 0 } });
    const job = await prisma.job.create({
      data: { workspaceId, columnId: column.id, position: 0, title: 'Job da Alice', createdBy: alice.id, collaborators: { create: [{ userId: alice.id }] } },
    });
    jobId = job.id;
    await prisma.jobComment.create({ data: { jobId, authorId: alice.id, body: 'comentário' } });
    await prisma.teamMessage.create({ data: { workspaceId, authorId: alice.id, body: 'oi time' } });
    await prisma.account.create({ data: { userId: alice.id, type: 'oauth', provider: 'google', providerAccountId: `vitest-${stamp}` } });
    const [userAId, userBId] = alice.id < bruno.id ? [alice.id, bruno.id] : [bruno.id, alice.id];
    const conversation = await prisma.directConversation.create({
      data: { workspaceId, userAId, userBId, messages: { create: [{ authorId: alice.id, body: 'segredo' }] } },
    });
    conversationId = conversation.id;
  });

  afterAll(async () => {
    if (!workspaceId) return;
    // Content first: its author FKs are RESTRICT, so a bare workspace cascade can trip over them.
    await prisma.directConversation.deleteMany({ where: { workspaceId } });
    await prisma.teamMessage.deleteMany({ where: { workspaceId } });
    await prisma.job.deleteMany({ where: { workspaceId } });
    await prisma.workspace.delete({ where: { id: workspaceId } }).catch(() => undefined);
  });

  it('shows members a read-only roster without account details', async () => {
    as(bruno);
    const response = await usersRoute.GET();
    expect(response.status).toBe(200);
    const body = (await response.json()) as { canManage: boolean; users: { id: string; hasPassword: boolean | null }[] };
    expect(body.canManage).toBe(false);
    expect(body.users.map((user) => user.id).sort()).toEqual([admin.id, alice.id, bruno.id].sort());
    expect(body.users.every((user) => user.hasPassword === null)).toBe(true);
  });

  it('refuses every team mutation from a member', async () => {
    as(bruno);
    expect((await userRoute.PATCH(json('PATCH', '/x', { disabled: true }), params(alice.id))).status).toBe(403);
    expect((await userRoute.DELETE(json('DELETE', '/x'), params(alice.id))).status).toBe(403);
    expect((await issueLinkRoute.POST(json('POST', '/x'), params(alice.id))).status).toBe(403);
    expect((await usersRoute.POST(json('POST', '/x', { name: 'X', email: `x-${stamp}@vitest.invalid` }))).status).toBe(403);
    expect((await activityRoute.GET(json('GET', '/api/activity'))).status).toBe(403);
  });

  it('never lets anyone change their own login e-mail', async () => {
    as(bruno);
    const response = await profileRoute.PATCH(json('PATCH', '/x', { name: 'Bruno', email: 'financeiro@evecompany.com.br' }));
    expect(response.status).toBe(403);
    const row = await prisma.user.findUniqueOrThrow({ where: { id: bruno.id } });
    expect(row.email).toBe(bruno.email);
  });

  it('ignores an isOwner flag sent when creating an account', async () => {
    as(admin);
    const response = await usersRoute.POST(json('POST', '/x', { name: 'Carla', email: `carla-${stamp}@vitest.invalid`, isOwner: true }));
    expect(response.status).toBe(201);
    const row = await prisma.user.findUniqueOrThrow({ where: { email: `carla-${stamp}@vitest.invalid` } });
    expect(row.isOwner).toBe(false);
  });

  it('still asks for deactivation before deleting', async () => {
    as(admin);
    const response = await userRoute.DELETE(json('DELETE', '/x'), params(alice.id));
    expect(response.status).toBe(409);
  });

  it('deletes an account that has jobs and chat messages, keeping the work and wiping the person', async () => {
    as(admin);
    expect((await userRoute.PATCH(json('PATCH', '/x', { disabled: true }), params(alice.id))).status).toBe(200);
    const response = await userRoute.DELETE(json('DELETE', '/x'), params(alice.id));
    expect(response.status).toBe(200);

    const row = await prisma.user.findUniqueOrThrow({ where: { id: alice.id } });
    expect(row.deletedAt).not.toBeNull();
    expect(row.disabledAt).not.toBeNull();
    expect(row.email).not.toBe(alice.email);
    expect(row.email.endsWith('.invalid')).toBe(true);
    expect(row.passwordHash).toBeNull();
    expect(row.image).toBeNull();
    expect(row.name).toBe('Alice (conta removida)');
    expect(await prisma.account.count({ where: { userId: alice.id } })).toBe(0);
    expect(await prisma.jobCollaborator.count({ where: { userId: alice.id } })).toBe(0);

    // The agency's work stays.
    expect(await prisma.job.count({ where: { id: jobId, createdBy: alice.id } })).toBe(1);
    expect(await prisma.jobComment.count({ where: { authorId: alice.id } })).toBe(1);
    expect(await prisma.teamMessage.count({ where: { authorId: alice.id } })).toBe(1);

    // The original e-mail is free for a brand-new account.
    expect(await prisma.user.findUnique({ where: { email: alice.email } })).toBeNull();

    // Gone from every roster, admin's included.
    const list = (await (await usersRoute.GET()).json()) as { users: { id: string }[] };
    expect(list.users.some((user) => user.id === alice.id)).toBe(false);
  });

  it('keeps the DM history for the other person but refuses new messages to a removed account', async () => {
    as(bruno);
    const response = await dmRoute.POST(json('POST', '/x', { body: 'ainda está aí?' }), params(conversationId));
    expect(response.status).toBe(409);
    expect(await prisma.directMessage.count({ where: { conversationId } })).toBe(1);
  });

  it('recovers a password through an admin, with a single-use link', async () => {
    // Bruno forgot it: the request tells the admins, same answer as an unknown e-mail.
    session.user = null;
    const asked = await requestRoute.POST(json('POST', '/x', { email: bruno.email }));
    expect(asked.status).toBe(200);
    const unknown = await requestRoute.POST(json('POST', '/x', { email: `ninguem-${stamp}@vitest.invalid` }));
    expect(unknown.status).toBe(200);
    expect(await unknown.json()).toEqual(await asked.clone().json());

    expect(await prisma.notification.count({ where: { userId: admin.id, type: 'passwordResetRequested' } })).toBe(1);

    // Asking twice doesn't pile up a second request or a second alert.
    await requestRoute.POST(json('POST', '/x', { email: bruno.email }));
    expect(await prisma.passwordResetRequest.count({ where: { userId: bruno.id } })).toBe(1);

    as(admin);
    const pending = (await (await pendingRoute.GET()).json()) as { requests: { user: { id: string } }[] };
    expect(pending.requests.map((request) => request.user.id)).toEqual([bruno.id]);

    const issued = await issueLinkRoute.POST(json('POST', '/x'), params(bruno.id));
    expect(issued.status).toBe(201);
    const { path } = (await issued.json()) as { path: string };
    const token = new URL(`http://x${path}`).searchParams.get('token')!;

    const stored = await prisma.passwordResetRequest.findFirstOrThrow({ where: { userId: bruno.id } });
    expect(stored.tokenHash).not.toBe(token); // only the hash is kept

    session.user = null;
    const done = await completeRoute.POST(json('POST', '/x', { token, password: 'senha-nova-456' }));
    expect(done.status).toBe(200);
    const row = await prisma.user.findUniqueOrThrow({ where: { id: bruno.id } });
    expect(await verifyPassword(row.passwordHash!, 'senha-nova-456')).toBe(true);

    const reused = await completeRoute.POST(json('POST', '/x', { token, password: 'outra-senha-789' }));
    expect(reused.status).toBe(400);

    as(admin);
    const after = (await (await pendingRoute.GET()).json()) as { requests: unknown[] };
    expect(after.requests).toEqual([]);
  });

  it('records the team activity for the admins, and never a private message', async () => {
    as(bruno);
    const created = await jobsRoute.POST(
      json('POST', '/x', { title: 'Post de lançamento', columnId: (await prisma.jobColumn.findFirstOrThrow({ where: { workspaceId } })).id }),
    );
    expect(created.status).toBe(201);

    as(admin);
    const response = await activityRoute.GET(json('GET', '/api/activity'));
    expect(response.status).toBe(200);
    const body = (await response.json()) as { entries: { action: string; actorLabel: string; summary: string }[] };
    const actions = body.entries.map((entry) => entry.action);

    expect(actions).toEqual(
      expect.arrayContaining([
        'job.create',
        'user.create',
        'user.disable',
        'user.delete',
        'auth.passwordResetRequested',
        'user.passwordResetLink',
        'auth.passwordReset',
      ]),
    );
    expect(body.entries.find((entry) => entry.action === 'job.create')).toMatchObject({ actorLabel: 'Bruno' });
    expect(body.entries.some((entry) => entry.summary.includes('segredo') || entry.summary.includes('ainda está aí'))).toBe(false);

    const onlyTeam = (await (await activityRoute.GET(json('GET', '/api/activity?area=team'))).json()) as { entries: { action: string }[] };
    expect(onlyTeam.entries.length).toBeGreaterThan(0);
    expect(onlyTeam.entries.every((entry) => entry.action.startsWith('user.') || entry.action.startsWith('role.'))).toBe(true);
  });
});
