import Redis from 'ioredis';

/**
 * The demo connector's "upstream system".
 *
 * A real connector talks to Notion or the Graph API. This one needs somewhere
 * for its fake remote to live that both the web process and the worker process
 * can see — otherwise an edit made in the browser would be invisible to the
 * next sync, and conflicts could never be demonstrated. Redis is already part
 * of the stack, so it plays the role of the external service.
 */
export interface DemoRecord {
  id: string;
  version: string;
  fields: Record<string, unknown>;
}

export interface DemoRemoteStore {
  load(instanceId: string): Promise<DemoRecord[] | null>;
  save(instanceId: string, records: DemoRecord[]): Promise<void>;
}

const REDIS_PREFIX = 'eve:demo-remote:';

export function createMemoryStore(): DemoRemoteStore {
  const data = new Map<string, DemoRecord[]>();
  return {
    async load(instanceId) {
      const found = data.get(instanceId);
      return found ? structuredClone(found) : null;
    },
    async save(instanceId, records) {
      data.set(instanceId, structuredClone(records));
    },
  };
}

export function createRedisStore(url: string): DemoRemoteStore {
  let client: Redis | undefined;
  // Fail fast rather than queueing commands while disconnected: a sync that
  // hangs forever would occupy a worker slot and never mark the instance as
  // errored. An unreachable fake remote should surface as a failed sync.
  const connection = () =>
    (client ??= new Redis(url, {
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
      connectTimeout: 2_000,
    }));

  return {
    async load(instanceId) {
      const raw = await connection().get(REDIS_PREFIX + instanceId);
      return raw ? (JSON.parse(raw) as DemoRecord[]) : null;
    },
    async save(instanceId, records) {
      await connection().set(REDIS_PREFIX + instanceId, JSON.stringify(records));
    },
  };
}

let store: DemoRemoteStore | undefined;

/** Tests inject a memory store so the suite never needs a running Redis. */
export function setDemoStore(next: DemoRemoteStore): void {
  store = next;
}

export function getDemoStore(): DemoRemoteStore {
  if (!store) {
    const url = process.env.REDIS_URL;
    store = url ? createRedisStore(url) : createMemoryStore();
  }
  return store;
}
