import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { graphRequest } from './graph-client';
import { pollInstagramContainerReady } from './publish';

// Only `graphRequest` is faked — MetaGraphError stays the real class so the
// status codes asserted below are the ones publish.ts actually throws.
vi.mock('./graph-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./graph-client')>()),
  graphRequest: vi.fn(),
}));

const mockedGraphRequest = vi.mocked(graphRequest);

/** Queues one `status_code` per poll, in order. */
function respondWith(...statuses: string[]): void {
  for (const status_code of statuses) {
    mockedGraphRequest.mockResolvedValueOnce({ status_code } as never);
  }
}

describe('pollInstagramContainerReady', () => {
  beforeEach(() => {
    mockedGraphRequest.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns as soon as the container is FINISHED', async () => {
    respondWith('FINISHED');
    await expect(pollInstagramContainerReady('token', 'container')).resolves.toBeUndefined();
    expect(mockedGraphRequest).toHaveBeenCalledTimes(1);
  });

  it('treats PUBLISHED as done instead of publishing it twice', async () => {
    respondWith('PUBLISHED');
    await expect(pollInstagramContainerReady('token', 'container')).resolves.toBeUndefined();
    expect(mockedGraphRequest).toHaveBeenCalledTimes(1);
  });

  it('fails fast on ERROR rather than burning the whole budget', async () => {
    respondWith('ERROR');
    await expect(pollInstagramContainerReady('token', 'container')).rejects.toMatchObject({ status: 422 });
    expect(mockedGraphRequest).toHaveBeenCalledTimes(1);
  });

  it('fails fast on EXPIRED', async () => {
    respondWith('EXPIRED');
    await expect(pollInstagramContainerReady('token', 'container')).rejects.toMatchObject({ status: 410 });
    expect(mockedGraphRequest).toHaveBeenCalledTimes(1);
  });

  it('keeps waiting through IN_PROGRESS, which the old 12s budget failed on', async () => {
    vi.useFakeTimers();
    respondWith('IN_PROGRESS', 'IN_PROGRESS', 'IN_PROGRESS', 'IN_PROGRESS', 'IN_PROGRESS', 'FINISHED');

    const pending = pollInstagramContainerReady('token', 'container');
    await vi.advanceTimersByTimeAsync(25_000);

    await expect(pending).resolves.toBeUndefined();
    expect(mockedGraphRequest).toHaveBeenCalledTimes(6);
  });

  it('gives up after the full budget without sleeping past the last look', async () => {
    vi.useFakeTimers();
    mockedGraphRequest.mockResolvedValue({ status_code: 'IN_PROGRESS' } as never);

    // Assert before advancing: the rejection lands mid-advance, and attaching
    // the handler afterwards would surface it as an unhandled rejection.
    const settled = expect(pollInstagramContainerReady('token', 'container')).rejects.toMatchObject({ status: 504 });
    // 12 attempts with 11 gaps of 5s: the error must already be thrown at 55s,
    // not one trailing sleep later.
    await vi.advanceTimersByTimeAsync(55_000);
    await settled;

    expect(mockedGraphRequest).toHaveBeenCalledTimes(12);
  });
});
