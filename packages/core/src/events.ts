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

let publisher: Redis | undefined;

function getPublisher(): Redis {
  if (!publisher) {
    publisher = new Redis(getEnv().REDIS_URL, { maxRetriesPerRequest: null, lazyConnect: false });
    publisher.on('error', (err) => console.error('[events] publisher error:', err.message));
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
  const subscriber = new Redis(getEnv().REDIS_URL, { maxRetriesPerRequest: null });

  subscriber.on('error', (err) => console.error('[events] subscriber error:', err.message));
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
    commandClient = new Redis(getEnv().REDIS_URL, { maxRetriesPerRequest: null });
    commandClient.on('error', (err) => console.error('[redis] error:', err.message));
  }
  return commandClient;
}
