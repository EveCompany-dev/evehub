/**
 * Keeps one BullMQ job scheduler per active connector instance, and none for
 * the rest. Run at boot and every few minutes after: an instance created
 * after the worker started starts syncing without a restart, and one deleted
 * or disabled stops being synced (instead of failing its sync forever).
 */

export const SYNC_SCHEDULER_PREFIX = 'sync-';

export interface SchedulerQueue {
  getJobSchedulers(start?: number, end?: number): Promise<{ key?: string; id?: string | null }[]>;
  removeJobScheduler(id: string): Promise<boolean>;
}

export interface ReconcileResult {
  added: string[];
  removed: string[];
}

/**
 * `upsert` is only called for instances that have no scheduler yet, so an
 * existing one keeps its offset (re-upserting all of them would re-jitter and
 * restart every interval on each run).
 */
export async function reconcileSyncSchedulers(
  queue: SchedulerQueue,
  activeInstanceIds: readonly string[],
  upsert: (instanceId: string) => Promise<void>,
): Promise<ReconcileResult> {
  const schedulers = await queue.getJobSchedulers(0, -1);
  const existing = new Set(
    schedulers
      .map((scheduler) => scheduler.key ?? scheduler.id ?? '')
      .filter((id) => id.startsWith(SYNC_SCHEDULER_PREFIX))
      .map((id) => id.slice(SYNC_SCHEDULER_PREFIX.length)),
  );
  const active = new Set(activeInstanceIds);

  const added: string[] = [];
  for (const id of active) {
    if (existing.has(id)) continue;
    await upsert(id);
    added.push(id);
  }

  const removed: string[] = [];
  for (const id of existing) {
    if (active.has(id)) continue;
    await queue.removeJobScheduler(`${SYNC_SCHEDULER_PREFIX}${id}`);
    removed.push(id);
  }

  return { added, removed };
}
