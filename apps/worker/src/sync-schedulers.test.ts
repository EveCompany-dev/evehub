import { describe, expect, it, vi } from 'vitest';
import { reconcileSyncSchedulers } from './sync-schedulers';

function fakeQueue(ids: string[]) {
  const current = new Set(ids);
  return {
    current,
    getJobSchedulers: vi.fn(async () => [...current].map((id) => ({ id, key: id }))),
    removeJobScheduler: vi.fn(async (id: string) => current.delete(id)),
  };
}

describe('reconcileSyncSchedulers', () => {
  it('adds a scheduler for a new instance and removes the ones for deleted or disabled instances', async () => {
    const queue = fakeQueue(['sync-a', 'sync-gone', 'prune-snapshots', 'media-cleanup']);
    const upsert = vi.fn(async (id: string) => void queue.current.add(`sync-${id}`));

    const result = await reconcileSyncSchedulers(queue, ['a', 'new'], upsert);

    expect(result).toEqual({ added: ['new'], removed: ['gone'] });
    expect(upsert).toHaveBeenCalledTimes(1);
    expect([...queue.current].sort()).toEqual(['media-cleanup', 'prune-snapshots', 'sync-a', 'sync-new']);
  });

  it('leaves an existing scheduler alone, so it keeps its offset', async () => {
    const queue = fakeQueue(['sync-a']);
    const upsert = vi.fn();
    await reconcileSyncSchedulers(queue, ['a'], upsert);
    expect(upsert).not.toHaveBeenCalled();
    expect(queue.removeJobScheduler).not.toHaveBeenCalled();
  });
});
