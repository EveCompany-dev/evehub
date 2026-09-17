import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { ContainerNotReadyError } from '@eve/connector-meta';
import { publishScheduledPost } from './publish-post';

vi.mock('@eve/connector-meta', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@eve/connector-meta')>();
  return {
    ...actual,
    assertMediaUrlIsPublic: vi.fn(),
    createInstagramContainer: vi.fn(),
    pollInstagramContainerReady: vi.fn(),
    publishInstagramContainer: vi.fn(),
  };
});

vi.mock('./prisma', () => ({
  prisma: {
    scheduledPost: { findUnique: vi.fn(), updateMany: vi.fn(), update: vi.fn() },
    notification: { create: vi.fn() },
  },
}));

vi.mock('./connector-context', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./connector-context')>()),
  loadConnectorContext: vi.fn(() => ({
    connector: {} as never,
    ctx: {
      instanceId: 'instance-1',
      config: { pageId: 'page-1', instagramBusinessAccountId: 'ig-1' },
      credentials: { pageAccessToken: 'token' },
      lastSyncedAt: null,
    },
  })),
}));

const meta = vi.mocked(await import('@eve/connector-meta'));

// Prisma's generated method signatures are generic enough that `vi.mocked`
// cannot express them as mocks; this is the test double's own shape, which is
// all these tests ever call.
const { prisma } = (await import('./prisma')) as unknown as {
  prisma: {
    scheduledPost: { findUnique: Mock; updateMany: Mock; update: Mock };
    notification: { create: Mock };
  };
};

function postRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'post-1',
    workspaceId: 'ws-1',
    connectorInstanceId: 'instance-1',
    connectorInstance: { id: 'instance-1' },
    platform: 'instagram',
    postType: 'feed',
    status: 'scheduled',
    caption: 'oi',
    mediaUrl: 'https://evecompany.cloud/uploads/post-media/a.jpg',
    mediaUrls: null,
    metaCreationId: null,
    metaPostId: null,
    clientLabel: 'Eve Company',
    createdBy: 'user-1',
    scheduledFor: new Date('2026-09-17T19:22:00Z'),
    ...overrides,
  } as never;
}

describe('publishScheduledPost', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prisma.scheduledPost.updateMany.mockResolvedValue({ count: 1 } as never);
    prisma.scheduledPost.update.mockResolvedValue({} as never);
    prisma.notification.create.mockResolvedValue({} as never);
  });

  it('publishes a due post and records the media id', async () => {
    prisma.scheduledPost.findUnique.mockResolvedValue(postRow());
    meta.createInstagramContainer.mockResolvedValue({ creationId: 'container-1' });
    meta.pollInstagramContainerReady.mockResolvedValue('FINISHED');
    meta.publishInstagramContainer.mockResolvedValue({ mediaId: 'media-1' });

    await expect(publishScheduledPost('post-1')).resolves.toMatchObject({
      ok: true,
      status: 'published',
      metaPostId: 'media-1',
    });
  });

  /**
   * The duplicate-post guard. A container Meta already published must never
   * be sent to media_publish again — that is how one post becomes two.
   */
  it('does not publish a container Meta reports as already PUBLISHED', async () => {
    prisma.scheduledPost.findUnique.mockResolvedValue(postRow({ metaCreationId: 'container-1' }));
    meta.pollInstagramContainerReady.mockResolvedValue('PUBLISHED');

    await expect(publishScheduledPost('post-1')).resolves.toMatchObject({
      ok: true,
      status: 'published',
      alreadyPublished: true,
    });
    expect(meta.publishInstagramContainer).not.toHaveBeenCalled();
    expect(meta.createInstagramContainer).not.toHaveBeenCalled();
  });

  /** Resuming, not restarting: a saved container is reused instead of making a second one. */
  it('reuses a container a previous interrupted run already created', async () => {
    prisma.scheduledPost.findUnique.mockResolvedValue(postRow({ status: 'publishing', metaCreationId: 'container-1' }));
    meta.pollInstagramContainerReady.mockResolvedValue('FINISHED');
    meta.publishInstagramContainer.mockResolvedValue({ mediaId: 'media-1' });

    await publishScheduledPost('post-1');

    expect(meta.createInstagramContainer).not.toHaveBeenCalled();
    expect(meta.publishInstagramContainer).toHaveBeenCalledWith('token', 'ig-1', 'container-1');
  });

  it('returns an already-published post untouched', async () => {
    prisma.scheduledPost.findUnique.mockResolvedValue(postRow({ status: 'published', metaPostId: 'media-1' }));

    await expect(publishScheduledPost('post-1')).resolves.toMatchObject({ status: 'published', alreadyPublished: true });
    expect(prisma.scheduledPost.updateMany).not.toHaveBeenCalled();
  });

  /** Two callers racing (the worker's tick and a "publicar agora" click) must not both publish. */
  it('refuses to publish a row another run currently holds', async () => {
    prisma.scheduledPost.findUnique.mockResolvedValue(postRow());
    prisma.scheduledPost.updateMany.mockResolvedValue({ count: 0 } as never);

    await expect(publishScheduledPost('post-1')).resolves.toMatchObject({ ok: false, status: 'busy' });
    expect(meta.createInstagramContainer).not.toHaveBeenCalled();
  });

  /** Still transcoding is not a failure: the row goes back to scheduled so the next run resumes it. */
  it('hands an unfinished container back as processing rather than failing it', async () => {
    prisma.scheduledPost.findUnique.mockResolvedValue(postRow());
    meta.createInstagramContainer.mockResolvedValue({ creationId: 'container-1' });
    meta.pollInstagramContainerReady.mockRejectedValue(new ContainerNotReadyError('container-1'));

    await expect(publishScheduledPost('post-1', { inlinePoll: true })).resolves.toMatchObject({
      ok: true,
      status: 'processing',
    });
    expect(prisma.scheduledPost.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'scheduled' }) }),
    );
  });

  it('marks a rejected post failed and notifies whoever scheduled it', async () => {
    prisma.scheduledPost.findUnique.mockResolvedValue(postRow());
    meta.createInstagramContainer.mockRejectedValue(new Error('O Instagram recusou a midia.'));

    await expect(publishScheduledPost('post-1')).resolves.toMatchObject({
      ok: false,
      status: 'failed',
      message: 'O Instagram recusou a midia.',
    });
    expect(prisma.scheduledPost.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'failed' }) }),
    );
    expect(prisma.notification.create).toHaveBeenCalled();
  });
});
