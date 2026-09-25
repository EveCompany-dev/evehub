import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * publishPost against an in-memory stand-in for the few Prisma calls it
 * makes, with the Meta helpers faked. `updateMany` applies its `where` the
 * way Postgres would, in one synchronous step, so two concurrent calls race
 * exactly like two runners do: only one of them can match. The same claim
 * against a real Postgres is in apps/web/src/lib/scheduling.db.test.ts.
 */

interface Row {
  id: string;
  workspaceId: string;
  connectorInstanceId: string;
  createdBy: string;
  clientLabel: string;
  platform: 'instagram' | 'facebook';
  postType: 'feed' | 'story' | 'reel';
  caption: string;
  mediaUrl: string;
  mediaUrls: string[] | null;
  scheduledFor: Date;
  status: 'draft' | 'scheduled' | 'publishing' | 'published' | 'failed';
  statusMessage: string | null;
  metaCreationId: string | null;
  metaPostId: string | null;
  permalink: string | null;
  contentRowId: string | null;
  updatedAt: Date;
}

const db = vi.hoisted(() => ({
  rows: new Map<string, Row>(),
  instanceStatus: 'ok' as string,
  notifications: [] as { userId: string; message: string }[],
}));

type Where = Record<string, unknown>;

function matches(row: Row, where: Where): boolean {
  for (const [key, condition] of Object.entries(where)) {
    const value = (row as unknown as Record<string, unknown>)[key];
    if (condition && typeof condition === 'object' && !(condition instanceof Date)) {
      const c = condition as { in?: unknown[]; lte?: Date; lt?: Date };
      if (c.in && !c.in.includes(value)) return false;
      if (c.lte && !((value as Date) <= c.lte)) return false;
      if (c.lt && !((value as Date) < c.lt)) return false;
    } else if (value !== condition) {
      return false;
    }
  }
  return true;
}

vi.mock('./prisma', () => ({
  prisma: {
    scheduledPost: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => {
        const row = db.rows.get(where.id);
        return row ? { ...row, connectorInstance: { id: row.connectorInstanceId, status: db.instanceStatus } } : null;
      }),
      updateMany: vi.fn(async ({ where, data }: { where: Where; data: Partial<Row> }) => {
        const row = db.rows.get(where.id as string);
        if (!row || !matches(row, where)) return { count: 0 };
        Object.assign(row, data, { updatedAt: data.updatedAt ?? new Date() });
        return { count: 1 };
      }),
    },
    notification: {
      create: vi.fn(async ({ data }: { data: { userId: string; message: string } }) => {
        db.notifications.push(data);
        return data;
      }),
    },
  },
}));

vi.mock('./connector-context', () => ({
  loadConnectorContext: () => ({ ctx: { config: { pageId: 'page-1', instagramBusinessAccountId: 'ig-1' }, credentials: { pageAccessToken: 'token' } } }),
}));

vi.mock('./content-posts', () => ({ refreshContentRow: vi.fn(async () => undefined) }));

const { publishPost, STALE_PUBLISHING_MS } = await import('./publish-post');
type Api = import('./publish-post').MetaPublishApi;

class FakeGraphError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}
class NotReady extends Error {}

function fakeApi(overrides: Partial<Api> = {}): Api & Record<string, ReturnType<typeof vi.fn>> {
  const api = {
    assertMediaUrlIsPublic: vi.fn(),
    mediaKindFromUrl: vi.fn((url: string) => (url.endsWith('.mp4') ? 'video' : 'image')),
    createInstagramContainer: vi.fn(async () => ({ creationId: 'container-new' })),
    createInstagramStoryContainer: vi.fn(async () => ({ creationId: 'container-story' })),
    createInstagramReelContainer: vi.fn(async () => ({ creationId: 'container-reel' })),
    createInstagramCarouselItemContainer: vi.fn(async (_t: string, _u: string, url: string) => ({ creationId: `child-${url}` })),
    createInstagramCarouselContainer: vi.fn(async () => ({ creationId: 'container-carousel' })),
    getInstagramContainerStatus: vi.fn(async () => 'FINISHED'),
    pollInstagramContainerReady: vi.fn(async () => 'FINISHED' as const),
    publishInstagramContainer: vi.fn(async () => {
      // A real publish takes a while: long enough for a racing caller to try.
      await new Promise((resolve) => setTimeout(resolve, 5));
      return { mediaId: 'media-1' };
    }),
    publishFacebookStory: vi.fn(async () => ({ postId: 'fb-story-1' })),
    fetchPermalink: vi.fn(async () => 'https://www.instagram.com/p/abc/'),
    isStillProcessing: (error: unknown) => error instanceof NotReady,
    isUnknownOutcomeError: (error: unknown) => !(error instanceof FakeGraphError) || error.status === 504 || error.status === 0,
    ...overrides,
  };
  return api as never;
}

const NOW = new Date('2026-09-24T15:00:00.000Z');
const clock = { now: () => NOW };

function row(overrides: Partial<Row> = {}): Row {
  const value: Row = {
    id: 'post-1',
    workspaceId: 'ws',
    connectorInstanceId: 'meta-1',
    createdBy: 'user-1',
    clientLabel: 'Café',
    platform: 'instagram',
    postType: 'feed',
    caption: 'Legenda',
    mediaUrl: 'https://hub.example/uploads/post-media/a.jpg',
    mediaUrls: null,
    scheduledFor: new Date(NOW.getTime() - 60_000),
    status: 'scheduled',
    statusMessage: null,
    metaCreationId: null,
    metaPostId: null,
    permalink: null,
    contentRowId: null,
    updatedAt: new Date(NOW.getTime() - 60_000),
    ...overrides,
  };
  db.rows.set(value.id, value);
  return value;
}

beforeEach(() => {
  db.rows.clear();
  db.notifications.length = 0;
  db.instanceStatus = 'ok';
});

describe('publishPost claim', () => {
  it('publishes once when two runners race for the same post', async () => {
    row();
    const api = fakeApi();

    const [first, second] = await Promise.all([
      publishPost('post-1', api, { mode: 'due', ...clock }),
      publishPost('post-1', api, { mode: 'due', ...clock }),
    ]);

    expect([first.kind, second.kind].sort()).toEqual(['published', 'skipped']);
    expect(api.createInstagramContainer).toHaveBeenCalledTimes(1);
    expect(api.publishInstagramContainer).toHaveBeenCalledTimes(1);
    expect(db.rows.get('post-1')).toMatchObject({ status: 'published', metaPostId: 'media-1', permalink: 'https://www.instagram.com/p/abc/' });
  });

  it('reclaims a post left in publishing by a runner that died', async () => {
    row({ status: 'publishing', updatedAt: new Date(NOW.getTime() - STALE_PUBLISHING_MS - 60_000) });
    const api = fakeApi();

    expect((await publishPost('post-1', api, { mode: 'due', ...clock })).kind).toBe('published');
    expect(api.publishInstagramContainer).toHaveBeenCalledTimes(1);
  });

  it('leaves a publishing post alone while its runner is still working on it', async () => {
    row({ status: 'publishing', updatedAt: new Date(NOW.getTime() - 30_000) });
    const api = fakeApi();

    expect(await publishPost('post-1', api, { mode: 'due', ...clock })).toMatchObject({ kind: 'skipped', reason: 'not-claimable' });
    expect(api.createInstagramContainer).not.toHaveBeenCalled();
  });

  it('never retries a failed post on its own; only an explicit retry does', async () => {
    row({ status: 'failed', statusMessage: 'erro antigo' });
    const api = fakeApi();

    expect((await publishPost('post-1', api, { mode: 'due', ...clock })).kind).toBe('skipped');
    expect(api.createInstagramContainer).not.toHaveBeenCalled();

    expect((await publishPost('post-1', api, { mode: 'now', allowFailed: true, ...clock })).kind).toBe('published');
    expect(db.rows.get('post-1')).toMatchObject({ status: 'published', statusMessage: null });
  });

  it('honors a reschedule made after the tick read the post', async () => {
    row({ scheduledFor: new Date(NOW.getTime() + 60 * 60_000) });
    const api = fakeApi();

    expect((await publishPost('post-1', api, { mode: 'due', ...clock })).kind).toBe('skipped');
    expect(api.createInstagramContainer).not.toHaveBeenCalled();
    expect(db.rows.get('post-1')!.status).toBe('scheduled');
  });

  it('publishes the post as it is at claim time, not as it was when the tick read it', async () => {
    const post = row();
    // The tick read the id; someone edits the caption before its turn comes.
    post.caption = 'Legenda nova';
    const api = fakeApi();

    await publishPost('post-1', api, { mode: 'due', ...clock });
    expect(api.createInstagramContainer).toHaveBeenCalledWith('token', 'ig-1', post.mediaUrl, 'Legenda nova');
  });

  it('skips a post that was deleted, without throwing', async () => {
    await expect(publishPost('gone', fakeApi(), { mode: 'due', ...clock })).resolves.toMatchObject({ kind: 'skipped', reason: 'not-found' });
  });

  it('moves the post to now on "Postar agora"', async () => {
    row({ scheduledFor: new Date(NOW.getTime() + 3 * 60 * 60_000) });
    await publishPost('post-1', fakeApi(), { mode: 'now', ...clock });
    expect(db.rows.get('post-1')).toMatchObject({ status: 'published', scheduledFor: NOW });
  });
});

describe('publishPost re-entrancy', () => {
  it('never sends a post that already has a metaPostId to Meta again', async () => {
    row({ status: 'publishing', metaPostId: 'media-9', updatedAt: new Date(NOW.getTime() - STALE_PUBLISHING_MS - 1000) });
    const api = fakeApi();

    expect((await publishPost('post-1', api, { mode: 'due', ...clock })).kind).toBe('published');
    expect(api.createInstagramContainer).not.toHaveBeenCalled();
    expect(api.publishInstagramContainer).not.toHaveBeenCalled();
    expect(api.getInstagramContainerStatus).not.toHaveBeenCalled();
    expect(db.rows.get('post-1')).toMatchObject({ status: 'published', metaPostId: 'media-9' });
  });

  it('reuses a saved container instead of creating a new one', async () => {
    row({ metaCreationId: 'container-old' });
    const api = fakeApi({ getInstagramContainerStatus: vi.fn(async () => 'FINISHED') });

    await publishPost('post-1', api, { mode: 'due', ...clock });
    expect(api.createInstagramContainer).not.toHaveBeenCalled();
    expect(api.publishInstagramContainer).toHaveBeenCalledWith('token', 'ig-1', 'container-old');
  });

  it('records a container Meta already published, without a second media_publish', async () => {
    row({ status: 'publishing', metaCreationId: 'container-old', updatedAt: new Date(NOW.getTime() - STALE_PUBLISHING_MS - 1000) });
    const api = fakeApi({ getInstagramContainerStatus: vi.fn(async () => 'PUBLISHED') });

    expect((await publishPost('post-1', api, { mode: 'due', ...clock })).kind).toBe('published');
    expect(api.publishInstagramContainer).not.toHaveBeenCalled();
    expect(api.createInstagramContainer).not.toHaveBeenCalled();
    expect(db.rows.get('post-1')!.status).toBe('published');
  });

  it('starts over when the saved container expired', async () => {
    row({ metaCreationId: 'container-old' });
    const api = fakeApi({ getInstagramContainerStatus: vi.fn(async () => 'EXPIRED') });

    await publishPost('post-1', api, { mode: 'due', ...clock });
    expect(api.createInstagramContainer).toHaveBeenCalledTimes(1);
    expect(api.publishInstagramContainer).toHaveBeenCalledWith('token', 'ig-1', 'container-new');
  });

  it('saves the container id before publishing it', async () => {
    row();
    let savedDuringPublish: string | null = null;
    const api = fakeApi({
      publishInstagramContainer: vi.fn(async () => {
        savedDuringPublish = db.rows.get('post-1')!.metaCreationId;
        return { mediaId: 'media-1' };
      }),
    });

    await publishPost('post-1', api, { mode: 'due', ...clock });
    expect(savedDuringPublish).toBe('container-new');
  });

  it('counts a media_publish that timed out as published when the container says so', async () => {
    row();
    const api = fakeApi({
      publishInstagramContainer: vi.fn(async () => {
        throw new FakeGraphError('A Graph API não respondeu a tempo.', 504);
      }),
      getInstagramContainerStatus: vi.fn(async () => 'PUBLISHED'),
    });

    expect((await publishPost('post-1', api, { mode: 'due', ...clock })).kind).toBe('published');
    expect(db.rows.get('post-1')).toMatchObject({ status: 'published', metaCreationId: 'container-new' });
    expect(db.notifications).toHaveLength(0);
  });

  it('says a post may have gone out when neither the publish nor the check answered, and the retry finds it', async () => {
    row();
    const timeout = async () => {
      throw new FakeGraphError('A Graph API não respondeu a tempo.', 504);
    };
    const api = fakeApi({ publishInstagramContainer: vi.fn(timeout), getInstagramContainerStatus: vi.fn(timeout) });

    const outcome = await publishPost('post-1', api, { mode: 'due', ...clock });
    expect(outcome.kind).toBe('failed');
    expect(db.rows.get('post-1')!.statusMessage).toMatch(/pode ter saído/);

    const retry = fakeApi({ getInstagramContainerStatus: vi.fn(async () => 'PUBLISHED') });
    expect((await publishPost('post-1', retry, { mode: 'now', allowFailed: true, ...clock })).kind).toBe('published');
    expect(retry.publishInstagramContainer).not.toHaveBeenCalled();
  });

  it('fails a media_publish that really did not go out, keeping the container for the retry', async () => {
    row();
    const api = fakeApi({
      publishInstagramContainer: vi.fn(async () => {
        throw new FakeGraphError('Limite de publicações atingido.', 400);
      }),
      getInstagramContainerStatus: vi.fn(async () => 'FINISHED'),
    });

    expect(await publishPost('post-1', api, { mode: 'due', ...clock })).toMatchObject({ kind: 'failed', message: 'Limite de publicações atingido.' });
    expect(db.rows.get('post-1')).toMatchObject({ status: 'failed', metaCreationId: 'container-new' });
    expect(db.notifications).toHaveLength(1);
  });

  it('hands a post whose video is still processing back to the worker, container kept', async () => {
    row({ postType: 'reel', mediaUrl: 'https://hub.example/uploads/post-media/v.mp4' });
    const api = fakeApi({
      pollInstagramContainerReady: vi.fn(async () => {
        throw new NotReady('ainda processando');
      }),
    });

    expect((await publishPost('post-1', api, { mode: 'due', ...clock })).kind).toBe('processing');
    expect(db.rows.get('post-1')).toMatchObject({ status: 'scheduled', metaCreationId: 'container-reel' });
    expect(api.publishInstagramContainer).not.toHaveBeenCalled();
  });
});

describe('publishPost failures', () => {
  it('refuses to publish through a disabled connection', async () => {
    row();
    db.instanceStatus = 'disabled';
    const api = fakeApi();

    const outcome = await publishPost('post-1', api, { mode: 'due', ...clock });
    expect(outcome.kind).toBe('failed');
    expect(api.createInstagramContainer).not.toHaveBeenCalled();
    expect(db.rows.get('post-1')!.statusMessage).toMatch(/desativada/);
  });

  it('says a Facebook story may have gone out when Meta never answered', async () => {
    row({ platform: 'facebook', postType: 'story' });
    const api = fakeApi({
      publishFacebookStory: vi.fn(async () => {
        throw new FakeGraphError('A Graph API não respondeu a tempo.', 504);
      }),
    });

    const outcome = await publishPost('post-1', api, { mode: 'due', ...clock });
    expect(outcome).toMatchObject({ kind: 'failed' });
    expect(db.rows.get('post-1')!.statusMessage).toMatch(/pode ter saído/);
  });

  it('does not re-send a Facebook story whose earlier attempt crashed mid-way', async () => {
    row({ platform: 'facebook', postType: 'story', status: 'publishing', updatedAt: new Date(NOW.getTime() - STALE_PUBLISHING_MS - 1000) });
    const api = fakeApi();

    expect((await publishPost('post-1', api, { mode: 'due', ...clock })).kind).toBe('failed');
    expect(api.publishFacebookStory).not.toHaveBeenCalled();
  });

  it('never publishes a Facebook feed post (Meta does, at its scheduled time)', async () => {
    row({ platform: 'facebook', postType: 'feed', metaPostId: null });
    const api = fakeApi();
    expect((await publishPost('post-1', api, { mode: 'now', ...clock })).kind).toBe('skipped');
    expect(db.rows.get('post-1')!.status).toBe('scheduled');
  });
});
