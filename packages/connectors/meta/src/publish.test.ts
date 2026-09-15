import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { graphRequest } from './graph-client';
import { assertMediaUrlIsPublic, pollInstagramContainerReady } from './publish';

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

/**
 * These rules exist because Meta downloads post media from the URL we hand
 * it: anything that only resolves inside this machine or network publishes
 * nothing, and Meta reports it as "Only photo or video can be accepted as
 * media type" — an error about file formats, for what is actually an
 * unreachable address.
 */
describe('assertMediaUrlIsPublic', () => {
  it('accepts a public https URL', () => {
    expect(() => assertMediaUrlIsPublic('https://hub.evecompany.com.br/uploads/post-media/a.png')).not.toThrow();
  });

  it('accepts a public host on a non-default port', () => {
    expect(() => assertMediaUrlIsPublic('http://203.0.113.10:3000/uploads/a.png')).not.toThrow();
  });

  it.each([
    ['localhost', 'http://localhost:3000/uploads/a.png'],
    ['loopback IP', 'http://127.0.0.1:3002/uploads/a.png'],
    ['0.0.0.0', 'http://0.0.0.0:3000/uploads/a.png'],
    ['IPv6 loopback', 'http://[::1]:3000/uploads/a.png'],
    ['mDNS .local', 'http://pc09.local:3000/uploads/a.png'],
    ['RFC1918 10/8', 'http://10.0.0.5/uploads/a.png'],
    ['RFC1918 192.168/16', 'http://192.168.1.20:3000/uploads/a.png'],
    ['RFC1918 172.16/12', 'http://172.20.0.3/uploads/a.png'],
    ['link-local', 'http://169.254.1.1/uploads/a.png'],
    ['CGNAT/tailnet', 'http://100.117.211.36:3002/uploads/a.png'],
  ])('rejects %s', (_label, url) => {
    expect(() => assertMediaUrlIsPublic(url)).toThrow(/não consegue baixar/i);
  });

  it('does not mistake a public address for a private one on the 172 boundary', () => {
    expect(() => assertMediaUrlIsPublic('http://172.32.0.1/uploads/a.png')).not.toThrow();
    expect(() => assertMediaUrlIsPublic('http://172.15.0.1/uploads/a.png')).not.toThrow();
  });

  it('rejects a non-http scheme', () => {
    expect(() => assertMediaUrlIsPublic('file:///C:/uploads/a.png')).toThrow(/http/i);
  });

  it('rejects a malformed URL', () => {
    expect(() => assertMediaUrlIsPublic('/uploads/post-media/a.png')).toThrow(/inválida/i);
  });
});
