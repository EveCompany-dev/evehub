import { getRedis, withRedisTimeout } from './events';

/**
 * Whether the background worker is alive, and since when.
 *
 * This exists because of a real incident: the worker stopped processing and
 * nothing anywhere said so. Scheduled posts simply sat at `scheduled` past
 * their time — no error, no failed state, no banner — and the only way to
 * find out was to notice that posts had quietly stopped going out. A
 * heartbeat costs one Redis key and turns that silence into a sentence.
 *
 * Redis rather than a table: the worker already holds a Redis connection for
 * its queue, the value is worthless once stale, and a TTL expresses "alive"
 * far better than a timestamp column nobody prunes.
 */
const HEARTBEAT_KEY = 'eve:worker:heartbeat';

/** Generous enough that one slow tick never reads as an outage. */
const HEARTBEAT_TTL_SECONDS = 300;

/** Called by the worker on every tick. Failing to record it must never break the tick itself. */
export async function touchWorkerHeartbeat(): Promise<void> {
  try {
    await getRedis().set(HEARTBEAT_KEY, new Date().toISOString(), 'EX', HEARTBEAT_TTL_SECONDS);
  } catch (error) {
    console.error('[worker-health] heartbeat nao registrado:', error instanceof Error ? error.message : error);
  }
}

export interface WorkerHealth {
  /** False means nothing has published for at least the TTL — scheduled posts are not going out. */
  alive: boolean;
  lastSeenAt: string | null;
}

/**
 * Read from the request path, so it fails soft: if Redis itself is the thing
 * that is down, report unknown-but-not-alive rather than breaking the page
 * that asked.
 */
export async function readWorkerHealth(): Promise<WorkerHealth> {
  try {
    const lastSeenAt = await withRedisTimeout(getRedis().get(HEARTBEAT_KEY));
    return { alive: lastSeenAt !== null, lastSeenAt };
  } catch {
    return { alive: false, lastSeenAt: null };
  }
}
