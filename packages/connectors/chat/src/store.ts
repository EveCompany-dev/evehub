import Redis from 'ioredis';
import type { ChatMessage } from './shared';

/** Conversation history, per widget instance. Same pattern as `notes`/`demo`'s stores. */
export interface ChatStore {
  load(instanceId: string): Promise<ChatMessage[]>;
  save(instanceId: string, messages: ChatMessage[]): Promise<void>;
}

const REDIS_PREFIX = 'eve:chat:';

export function createMemoryStore(): ChatStore {
  const data = new Map<string, ChatMessage[]>();
  return {
    async load(instanceId) {
      return data.get(instanceId) ?? [];
    },
    async save(instanceId, messages) {
      data.set(instanceId, messages);
    },
  };
}

export function createRedisStore(url: string): ChatStore {
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
      return raw ? (JSON.parse(raw) as ChatMessage[]) : [];
    },
    async save(instanceId, messages) {
      await connection().set(REDIS_PREFIX + instanceId, JSON.stringify(messages));
    },
  };
}

let store: ChatStore | undefined;

/** Tests inject a memory store so the suite never needs a running Redis. */
export function setChatStore(next: ChatStore): void {
  store = next;
}

export function getChatStore(): ChatStore {
  if (!store) {
    const url = process.env.REDIS_URL;
    store = url ? createRedisStore(url) : createMemoryStore();
  }
  return store;
}
