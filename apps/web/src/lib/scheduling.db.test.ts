import 'dotenv/config';
import { encryptJson, prisma, publishPost, refreshContentRow, type MetaPublishApi } from '@eve/core';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Scheduling against the real Postgres: the conditional claim (two runners,
 * one publish), who may change or publish a post, and the checks that must
 * run before Meta is touched. The route handlers are the real ones; only the
 * session and the Meta calls are faked. Skips without a database, like
 * authz.db.test.ts.
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
  const requireInstance = async (instanceId: string, user: { workspaceId: string }) => {
    const { prisma: db } = await import('@eve/core');
    const instance = await db.connectorInstance.findUnique({ where: { id: instanceId } });
    if (!instance || instance.workspaceId !== user.workspaceId) throw new HttpError(404, 'not found');
    return instance;
  };
  return { HttpError, requireUser, requireOwner: requireUser, getSessionUser: async () => session.user, requireInstance };
});

const meta = vi.hoisted(() => ({
  deleteFacebookPost: vi.fn(async () => undefined),
  scheduleFacebookPost: vi.fn(async () => ({ postId: 'page_scheduled' })),
  publishInstagramContainer: vi.fn(async () => ({ mediaId: 'media-db' })),
}));

vi.mock('@eve/connector-meta', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@eve/connector-meta')>();
  return {
    ...actual,
    deleteFacebookPost: meta.deleteFacebookPost,
    scheduleFacebookPost: meta.scheduleFacebookPost,
    // The routes' own publish path never reaches Meta in these tests.
    metaPublishApi: { ...actual.metaPublishApi, publishInstagramContainer: meta.publishInstagramContainer },
  };
});

async function databaseUp(): Promise<boolean> {
  try {
    await prisma.$queryRaw`SELECT 1`;
    await prisma.$queryRaw`SELECT "metaCreationId" FROM "ScheduledPost" LIMIT 1`;
    return Boolean(process.env.CREDENTIALS_KEY);
  } catch {
    return false;
  }
}

const dbUp = await databaseUp();

const postsRoute = await import('../app/api/scheduling/posts/route');
const postRoute = await import('../app/api/scheduling/posts/[id]/route');
const publishRoute = await import('../app/api/scheduling/posts/[id]/publish/route');

function json(method: string, body: unknown): Request {
  return new Request('http://test/api/scheduling', { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
}

const params = (id: string) => ({ params: Promise.resolve({ id }) });

function fakeApi(): MetaPublishApi & { publishInstagramContainer: ReturnType<typeof vi.fn>; createInstagramContainer: ReturnType<typeof vi.fn> } {
  return {
    assertMediaUrlIsPublic: () => undefined,
    mediaKindFromUrl: () => 'image',
    createInstagramContainer: vi.fn(async () => ({ creationId: 'container-db' })),
    createInstagramStoryContainer: vi.fn(),
    createInstagramReelContainer: vi.fn(),
    createInstagramCarouselItemContainer: vi.fn(),
    createInstagramCarouselContainer: vi.fn(),
    getInstagramContainerStatus: vi.fn(async () => 'FINISHED'),
    pollInstagramContainerReady: vi.fn(async () => 'FINISHED' as const),
    publishInstagramContainer: vi.fn(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      return { mediaId: 'media-db' };
    }),
    publishFacebookStory: vi.fn(),
    fetchPermalink: vi.fn(async () => null),
    isStillProcessing: () => false,
    isUnknownOutcomeError: () => false,
  } as never;
}

describe.skipIf(!dbUp)('scheduling against Postgres', () => {
  let workspaceId = '';
  let ownerId = '';
  let memberId = '';
  let otherId = '';
  let instanceId = '';
  let clientId = '';

  const as = (id: string, isOwner: boolean) => {
    session.user = { id, email: `${id}@vitest.invalid`, name: id, image: null, isOwner, isSocialMedia: false, roleTabs: null, workspaceId };
  };

  const createPost = (data: Partial<Parameters<typeof prisma.scheduledPost.create>[0]['data']> = {}) =>
    prisma.scheduledPost.create({
      data: {
        workspaceId,
        connectorInstanceId: instanceId,
        clientSource: 'local',
        clientId,
        clientLabel: 'Cliente',
        platform: 'instagram',
        postType: 'feed',
        caption: 'Legenda',
        mediaUrl: 'https://hub.example.com/uploads/post-media/a.jpg',
        scheduledFor: new Date(Date.now() - 60_000),
        status: 'scheduled',
        createdBy: otherId,
        ...data,
      } as Parameters<typeof prisma.scheduledPost.create>[0]['data'],
    });

  beforeAll(async () => {
    const stamp = Date.now();
    workspaceId = (await prisma.workspace.create({ data: { name: `vitest-scheduling-${stamp}` } })).id;
    ownerId = (await prisma.user.create({ data: { workspaceId, email: `owner-${stamp}@vitest.invalid`, isOwner: true } })).id;
    memberId = (await prisma.user.create({ data: { workspaceId, email: `member-${stamp}@vitest.invalid` } })).id;
    otherId = (await prisma.user.create({ data: { workspaceId, email: `other-${stamp}@vitest.invalid` } })).id;
    clientId = (await prisma.client.create({ data: { workspaceId, name: 'Cliente' } })).id;
    const encrypted = encryptJson({ pageAccessToken: 'vitest-page-token' });
    instanceId = (
      await prisma.connectorInstance.create({
        data: {
          workspaceId,
          connectorId: 'meta',
          label: 'Meta',
          config: { pageId: '1234567890', instagramBusinessAccountId: '17841400000000000' },
          credentialsEnc: new Uint8Array(encrypted.data),
          credentialsKeyVersion: encrypted.keyVersion,
        },
      })
    ).id;
  });

  afterAll(async () => {
    if (workspaceId) await prisma.workspace.delete({ where: { id: workspaceId } }).catch(() => undefined);
  });

  beforeEach(() => {
    meta.deleteFacebookPost.mockClear();
    meta.scheduleFacebookPost.mockClear();
    meta.publishInstagramContainer.mockClear();
  });

  it('claims a post once when two runners race for it', async () => {
    const post = await createPost();
    const api = fakeApi();

    const outcomes = await Promise.all([
      publishPost(post.id, api, { mode: 'due' }),
      publishPost(post.id, api, { mode: 'due' }),
      publishPost(post.id, api, { mode: 'now' }),
    ]);

    expect(outcomes.filter((outcome) => outcome.kind === 'published')).toHaveLength(1);
    expect(api.publishInstagramContainer).toHaveBeenCalledTimes(1);
    expect(await prisma.scheduledPost.findUnique({ where: { id: post.id } })).toMatchObject({ status: 'published', metaPostId: 'media-db', metaCreationId: 'container-db' });
  });

  it('reclaims a stale publishing row, and not a fresh one', async () => {
    const fresh = await createPost({ status: 'publishing' });
    const api = fakeApi();
    expect((await publishPost(fresh.id, api, { mode: 'due' })).kind).toBe('skipped');

    await prisma.$executeRaw`UPDATE "ScheduledPost" SET "updatedAt" = now() - interval '10 minutes' WHERE "id" = ${fresh.id}`;
    expect((await publishPost(fresh.id, api, { mode: 'due' })).kind).toBe('published');
  });

  it("refuses a member changing, cancelling or publishing a colleague's post", async () => {
    const post = await createPost({ scheduledFor: new Date(Date.now() + 60 * 60_000) });
    as(memberId, false);

    expect((await postRoute.PATCH(json('PATCH', { caption: 'mudou' }), params(post.id))).status).toBe(403);
    expect((await postRoute.DELETE(new Request('http://test', { method: 'DELETE' }), params(post.id))).status).toBe(403);
    expect((await publishRoute.POST(new Request('http://test', { method: 'POST' }), params(post.id))).status).toBe(403);

    expect(await prisma.scheduledPost.findUnique({ where: { id: post.id } })).toMatchObject({ caption: 'Legenda', status: 'scheduled' });
    expect(meta.publishInstagramContainer).not.toHaveBeenCalled();
  });

  it('lets the creator and an admin change it', async () => {
    const post = await createPost({ scheduledFor: new Date(Date.now() + 60 * 60_000) });
    as(otherId, false);
    expect((await postRoute.PATCH(json('PATCH', { caption: 'pela autora' }), params(post.id))).status).toBe(200);
    as(ownerId, true);
    expect((await postRoute.PATCH(json('PATCH', { caption: 'pelo admin' }), params(post.id))).status).toBe(200);
  });

  it('refuses to cancel a post mid-publish', async () => {
    const post = await createPost({ status: 'publishing', createdBy: memberId });
    as(memberId, false);
    expect((await postRoute.DELETE(new Request('http://test', { method: 'DELETE' }), params(post.id))).status).toBe(409);
    expect(await prisma.scheduledPost.findUnique({ where: { id: post.id } })).not.toBeNull();
  });

  it('refuses a Facebook feed edit under 10 minutes out without cancelling the live schedule', async () => {
    const post = await createPost({
      platform: 'facebook',
      postType: 'feed',
      metaPostId: 'page_live',
      createdBy: memberId,
      scheduledFor: new Date(Date.now() + 2 * 60 * 60_000),
    });
    as(memberId, false);

    const response = await postRoute.PATCH(json('PATCH', { scheduledFor: new Date(Date.now() + 2 * 60_000).toISOString() }), params(post.id));
    expect(response.status).toBe(400);
    expect(meta.deleteFacebookPost).not.toHaveBeenCalled();
    expect(await prisma.scheduledPost.findUnique({ where: { id: post.id } })).toMatchObject({ metaPostId: 'page_live', status: 'scheduled' });
  });

  it('refuses a post for a client that is not in the workspace, before any Meta call', async () => {
    as(memberId, false);
    const response = await postsRoute.POST(
      json('POST', {
        connectorInstanceId: instanceId,
        client: { id: 'not-a-client', label: 'Ninguém' },
        targets: [{ platform: 'facebook', postType: 'feed' }],
        caption: 'Legenda',
        mediaUrl: 'https://hub.example.com/uploads/post-media/a.jpg',
        scheduledFor: new Date(Date.now() + 60 * 60_000).toISOString(),
      }),
    );
    expect(response.status).toBe(400);
    expect(meta.scheduleFacebookPost).not.toHaveBeenCalled();
  });

  it('creates the Facebook feed row before calling Meta, and keeps it as failed when Meta errors', async () => {
    as(memberId, false);
    meta.scheduleFacebookPost.mockImplementationOnce(async () => {
      throw new Error('Meta caiu');
    });
    const response = await postsRoute.POST(
      json('POST', {
        connectorInstanceId: instanceId,
        client: { id: clientId, label: 'Cliente' },
        targets: [{ platform: 'facebook', postType: 'feed' }],
        caption: 'Legenda FB',
        mediaUrl: 'https://hub.example.com/uploads/post-media/a.jpg',
        scheduledFor: new Date(Date.now() + 60 * 60_000).toISOString(),
      }),
    );
    expect(response.status).toBe(201);
    const rows = await prisma.scheduledPost.findMany({ where: { workspaceId, caption: 'Legenda FB' } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: 'failed', metaPostId: null });
  });

  it('moves a content row\'s Status without touching the fields someone else edits', async () => {
    const table = await prisma.dataTable.create({ data: { workspaceId, name: 'Calendário', columns: [] } });
    const row = await prisma.dataTableRow.create({ data: { tableId: table.id, data: { titulo: 'Antes', status: 'Em aprovação', data: '2026-01-01' } } });
    await createPost({ contentRowId: row.id, scheduledFor: new Date('2026-09-25T13:00:00.000Z') });

    // Someone edits the title while the post's status is being written.
    await prisma.dataTableRow.update({ where: { id: row.id }, data: { data: { titulo: 'Depois', status: 'Em aprovação', data: '2026-01-01' } } });
    await refreshContentRow(row.id);

    expect((await prisma.dataTableRow.findUnique({ where: { id: row.id } }))!.data).toEqual({ titulo: 'Depois', status: 'Programado', data: '2026-09-25' });
  });
});
