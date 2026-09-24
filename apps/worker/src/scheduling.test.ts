import { beforeEach, describe, expect, it, vi } from 'vitest';

const core = vi.hoisted(() => ({
  due: [] as { id: string; platform: string; connectorInstanceId: string }[],
  facebookFeed: [] as Record<string, unknown>[],
  markFailed: vi.fn(async () => 'x'),
  markPublished: vi.fn(async () => undefined),
}));

vi.mock('@eve/core', () => ({
  STALE_PUBLISHING_MS: 5 * 60_000,
  prisma: {
    scheduledPost: {
      findMany: vi.fn(async ({ where }: { where: { platform?: string } }) => (where.platform === 'facebook' ? core.facebookFeed : core.due)),
    },
  },
  publishPost: vi.fn(),
  markFailed: core.markFailed,
  markPublished: core.markPublished,
  loadConnectorContext: () => ({ ctx: { credentials: { pageAccessToken: 'token' } } }),
}));

const meta = vi.hoisted(() => ({ checkFacebookPostStatus: vi.fn() }));
vi.mock('@eve/connector-meta', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@eve/connector-meta')>()),
  checkFacebookPostStatus: meta.checkFacebookPostStatus,
}));

const { MetaGraphError } = await import('@eve/connector-meta');
const { processDuePosts, SAME_ACCOUNT_GAP_MS } = await import('./scheduling');

beforeEach(() => {
  core.due = [];
  core.facebookFeed = [];
  core.markFailed.mockClear();
  core.markPublished.mockClear();
  meta.checkFacebookPostStatus.mockReset();
});

describe('processDuePosts', () => {
  it('keeps going past a post that vanished and one that blew up', async () => {
    core.due = [
      { id: 'deleted', platform: 'instagram', connectorInstanceId: 'a' },
      { id: 'explodes', platform: 'instagram', connectorInstanceId: 'b' },
      { id: 'fine', platform: 'instagram', connectorInstanceId: 'c' },
    ];
    const publish = vi.fn(async (id: string) => {
      if (id === 'deleted') return { kind: 'skipped' as const, postId: id, reason: 'not-found' as const };
      if (id === 'explodes') throw new Error('P2025');
      return { kind: 'published' as const, postId: id };
    });

    const summary = await processDuePosts({ publish, sleep: async () => undefined });

    expect(publish.mock.calls.map(([id]) => id)).toEqual(['deleted', 'explodes', 'fine']);
    expect(summary.published).toBe(1);
  });

  it('spaces two posts to the same Instagram account, not posts to different ones', async () => {
    core.due = [
      { id: 'a1', platform: 'instagram', connectorInstanceId: 'a' },
      { id: 'b1', platform: 'instagram', connectorInstanceId: 'b' },
      { id: 'a2', platform: 'instagram', connectorInstanceId: 'a' },
    ];
    const sleep = vi.fn(async () => undefined);
    await processDuePosts({ publish: vi.fn(async (id: string) => ({ kind: 'published' as const, postId: id })), sleep });

    expect(sleep).toHaveBeenCalledTimes(1);
    expect((sleep.mock.calls[0] as unknown as [number])[0]).toBeGreaterThan(SAME_ACCOUNT_GAP_MS - 1000);
  });

  it('only asks publishPost for due posts (mode "due"), so a reschedule since the read is honored', async () => {
    core.due = [{ id: 'p', platform: 'facebook', connectorInstanceId: 'a' }];
    const publish = vi.fn(async (id: string) => ({ kind: 'skipped' as const, postId: id, reason: 'not-claimable' as const }));
    await processDuePosts({ publish, sleep: async () => undefined });
    expect(publish).toHaveBeenCalledWith('p', expect.anything(), { mode: 'due' });
  });
});

describe('Facebook feed reconciliation', () => {
  const feedPost = (overrides: Record<string, unknown> = {}) => ({
    id: 'fb',
    platform: 'facebook',
    postType: 'feed',
    metaPostId: 'page_1',
    scheduledFor: new Date(Date.now() - 60_000),
    connectorInstance: {},
    ...overrides,
  });

  it('fails a post Meta says no longer exists, right away', async () => {
    core.facebookFeed = [feedPost()];
    meta.checkFacebookPostStatus.mockRejectedValue(new MetaGraphError('Object with ID page_1 does not exist', 400, 100, 33));

    await processDuePosts({ publish: vi.fn(), sleep: async () => undefined });
    expect(core.markFailed).toHaveBeenCalledTimes(1);
    expect(String((core.markFailed.mock.calls[0] as unknown as [unknown, Error])[1].message)).toMatch(/não existe mais/);
  });

  it('fails a post it still cannot check past the grace period (an expired token, say)', async () => {
    core.facebookFeed = [feedPost({ scheduledFor: new Date(Date.now() - 20 * 60_000) })];
    meta.checkFacebookPostStatus.mockRejectedValue(new MetaGraphError('Error validating access token', 401, 190));

    await processDuePosts({ publish: vi.fn(), sleep: async () => undefined });
    expect(core.markFailed).toHaveBeenCalledTimes(1);
  });

  it('only logs a check error inside the grace period', async () => {
    core.facebookFeed = [feedPost()];
    meta.checkFacebookPostStatus.mockRejectedValue(new MetaGraphError('Service unavailable', 503));
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await processDuePosts({ publish: vi.fn(), sleep: async () => undefined });
    expect(core.markFailed).not.toHaveBeenCalled();
    log.mockRestore();
  });

  it('records a published one', async () => {
    core.facebookFeed = [feedPost()];
    meta.checkFacebookPostStatus.mockResolvedValue({ isPublished: true });

    await processDuePosts({ publish: vi.fn(), sleep: async () => undefined });
    expect(core.markPublished).toHaveBeenCalledTimes(1);
  });
});
