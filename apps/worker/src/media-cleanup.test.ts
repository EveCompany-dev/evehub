import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const core = vi.hoisted(() => ({ posts: [] as { mediaUrl: string; mediaUrls: unknown }[] }));

vi.mock('@eve/core', () => ({
  getEnv: () => ({ MEDIA_RETENTION_DAYS: 7, PUBLIC_BASE_URL: 'https://hub.example.com' }),
  prisma: { scheduledPost: { findMany: vi.fn(async () => core.posts) } },
}));

const { cleanupPublishedMedia, ownPostMediaPath } = await import('./media-cleanup');

const ROOT = path.resolve('/data/uploads');
const BASE = 'https://hub.example.com';

beforeEach(() => {
  core.posts = [];
});

describe('ownPostMediaPath', () => {
  it("accepts this app's own post media", () => {
    expect(ownPostMediaPath(`${BASE}/uploads/post-media/abc-123.jpg`, BASE, ROOT)).toBe(path.join(ROOT, 'post-media', 'abc-123.jpg'));
  });

  it('ignores the same path on another host', () => {
    expect(ownPostMediaPath('https://other-host.example/uploads/post-media/abc-123.jpg', BASE, ROOT)).toBeNull();
  });

  it('ignores other upload folders, nested paths and dot segments', () => {
    expect(ownPostMediaPath(`${BASE}/uploads/avatars/abc-123.png`, BASE, ROOT)).toBeNull();
    expect(ownPostMediaPath(`${BASE}/uploads/post-media/sub/abc.png`, BASE, ROOT)).toBeNull();
    expect(ownPostMediaPath(`${BASE}/uploads/post-media/..%2Favatars%2Fabc.png`, BASE, ROOT)).toBeNull();
    expect(ownPostMediaPath(`${BASE}/uploads/post-media/../avatars/abc.png`, BASE, ROOT)).toBeNull();
  });

  it('deletes nothing when the public address is unknown', () => {
    expect(ownPostMediaPath(`${BASE}/uploads/post-media/abc.jpg`, undefined, ROOT)).toBeNull();
  });
});

describe('cleanupPublishedMedia', () => {
  it('removes only unreferenced files of its own, and keeps anything still in use', async () => {
    core.posts = [
      { mediaUrl: `${BASE}/uploads/post-media/old.jpg`, mediaUrls: null },
      { mediaUrl: 'https://other-host.example/uploads/avatars/me.png', mediaUrls: null },
      { mediaUrl: `${BASE}/uploads/avatars/me.png`, mediaUrls: null },
      { mediaUrl: `${BASE}/uploads/post-media/shared.jpg`, mediaUrls: [`${BASE}/uploads/post-media/shared.jpg`, `${BASE}/uploads/post-media/slide2.jpg`] },
    ];
    const remove = vi.fn(async (_file: string) => undefined);
    const isReferenced = vi.fn(async (name: string) => name === 'shared.jpg');

    const removed = await cleanupPublishedMedia({ root: ROOT, remove, isReferenced });

    expect(removed).toBe(2);
    expect(remove.mock.calls.map(([file]) => file).sort()).toEqual([path.join(ROOT, 'post-media', 'old.jpg'), path.join(ROOT, 'post-media', 'slide2.jpg')]);
  });

  it('does nothing without PUBLIC_BASE_URL', async () => {
    core.posts = [{ mediaUrl: `${BASE}/uploads/post-media/old.jpg`, mediaUrls: null }];
    const remove = vi.fn(async (_file: string) => undefined);
    expect(await cleanupPublishedMedia({ root: ROOT, remove, publicBaseUrl: undefined, isReferenced: async () => false })).toBe(0);
    expect(remove).not.toHaveBeenCalled();
  });
});
