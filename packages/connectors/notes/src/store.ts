import Redis from 'ioredis';

/**
 * The note's actual source of truth. There is no upstream to sync from, so
 * (like the demo connector) this connector owns its own tiny persisted store
 * instead of treating `SyncRecord` — a synced mirror — as canonical.
 */
export interface NoteState {
  text: string;
  version: string;
}

export interface NoteStore {
  load(instanceId: string): Promise<NoteState | null>;
  save(instanceId: string, state: NoteState): Promise<void>;
}

const REDIS_PREFIX = 'eve:note:';

export function createMemoryStore(): NoteStore {
  const data = new Map<string, NoteState>();
  return {
    async load(instanceId) {
      return data.get(instanceId) ?? null;
    },
    async save(instanceId, state) {
      data.set(instanceId, state);
    },
  };
}

export function createRedisStore(url: string): NoteStore {
  let client: Redis | undefined;
  const connection = () =>
    (client ??= new Redis(url, {
      maxRetriesPerRequest: 1,
      connectTimeout: 2_000,
      commandTimeout: 2_000,
    }));

  return {
    async load(instanceId) {
      const raw = await connection().get(REDIS_PREFIX + instanceId);
      return raw ? (JSON.parse(raw) as NoteState) : null;
    },
    async save(instanceId, state) {
      await connection().set(REDIS_PREFIX + instanceId, JSON.stringify(state));
    },
  };
}

let store: NoteStore | undefined;

/** Tests inject a memory store so the suite never needs a running Redis. */
export function setNoteStore(next: NoteStore): void {
  store = next;
}

export function getNoteStore(): NoteStore {
  if (!store) {
    const url = process.env.REDIS_URL;
    store = url ? createRedisStore(url) : createMemoryStore();
  }
  return store;
}
