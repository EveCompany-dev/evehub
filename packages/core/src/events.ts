import Redis from 'ioredis';
import { getEnv } from './env';

export const CONNECTOR_CHANNEL = 'eve:connector';

export interface ConnectorUpdatedEvent {
  type: 'connector:updated';
  workspaceId: string;
  instanceId: string;
  connectorId: string;
  status: string;
  syncedAt: string;
}

/**
 * Options for every Redis client used on a request path.
 *
 * `enableOfflineQueue: false` is the important one: with the queue enabled (the
 * default) a command issued while the connection is down is buffered and its
 * promise never settles, so an `await` hangs forever instead of rejecting — a
 * stopped Redis container turns into a request that never returns. Failing fast
 * lets callers catch the error and degrade.
 *
 * BullMQ requires `maxRetriesPerRequest: null` on *its* connection, which is
 * why the worker builds its own client instead of reusing these.
 */
const REQUEST_PATH_OPTIONS = {
  maxRetriesPerRequest: 1,
  enableOfflineQueue: false,
  connectTimeout: 2_000,
  retryStrategy: (attempt: number) => Math.min(attempt * 500, 5_000),
} as const;

function describeRedisError(error: Error): string {
  // ioredis connection errors frequently carry an empty `message`.
  const code = (error as NodeJS.ErrnoException).code;
  return error.message || code || error.name || 'erro desconhecido';
}

let publisher: Redis | undefined;

function getPublisher(): Redis {
  if (!publisher) {
    publisher = new Redis(getEnv().REDIS_URL, REQUEST_PATH_OPTIONS);
    publisher.on('error', (err) => console.error('[events] publisher:', describeRedisError(err)));
  }
  return publisher;
}

export async function publishConnectorEvent(event: ConnectorUpdatedEvent): Promise<void> {
  try {
    await getPublisher().publish(CONNECTOR_CHANNEL, JSON.stringify(event));
  } catch (error) {
    // A dropped notification must never fail the sync that produced it: the
    // data is already committed, the UI just refreshes a bit later.
    console.error('[events] publish failed:', error instanceof Error ? error.message : error);
  }
}

/**
 * Opens a dedicated subscriber connection. Redis puts a connection in
 * subscriber mode exclusively, so this cannot share the publisher's socket.
 */
export function subscribeToConnectorEvents(onEvent: (event: ConnectorUpdatedEvent) => void): () => void {
  // The subscriber is a long-lived background stream, so it keeps retrying
  // rather than failing fast: reconnecting on its own is the desired behaviour.
  const subscriber = new Redis(getEnv().REDIS_URL, {
    maxRetriesPerRequest: null,
    retryStrategy: (attempt: number) => Math.min(attempt * 1_000, 10_000),
  });

  subscriber.on('error', (err) => console.error('[events] subscriber:', describeRedisError(err)));
  void subscriber.subscribe(CONNECTOR_CHANNEL);
  subscriber.on('message', (channel, raw) => {
    if (channel !== CONNECTOR_CHANNEL) return;
    try {
      onEvent(JSON.parse(raw) as ConnectorUpdatedEvent);
    } catch {
      console.error('[events] ignoring malformed event payload');
    }
  });

  return () => {
    void subscriber.quit();
  };
}

/** Shared connection for non-pub/sub uses (rate limiting, the demo's fake remote). */
let commandClient: Redis | undefined;

export function getRedis(): Redis {
  if (!commandClient) {
    commandClient = new Redis(getEnv().REDIS_URL, REQUEST_PATH_OPTIONS);
    commandClient.on('error', (err) => console.error('[redis]', describeRedisError(err)));
  }
  return commandClient;
}

/**
 * Rejects if `operation` outruns `ms`.
 *
 * Belt and braces on top of `enableOfflineQueue: false`: no Redis pathology
 * should ever be able to hold a user-facing request open.
 */
export async function withRedisTimeout<T>(operation: Promise<T>, ms = 1_500): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(`Redis nao respondeu em ${ms}ms`)), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
