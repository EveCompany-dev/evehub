import { subscribeToConnectorEvents, type LiveEvent } from '@eve/core';

type Listener = (event: LiveEvent) => void;

/**
 * One Redis subscriber per Node process, fanned out to every open SSE stream.
 *
 * Subscribing per connected tab would open a Redis connection per browser tab;
 * this keeps it at one regardless of how many people have the dashboard open.
 */
const listeners = new Set<Listener>();
let unsubscribe: (() => void) | undefined;

export function addConnectorListener(listener: Listener): () => void {
  listeners.add(listener);

  unsubscribe ??= subscribeToConnectorEvents((event) => {
    for (const fn of listeners) {
      try {
        fn(event);
      } catch (error) {
        console.error('[event-bus] listener failed:', error);
      }
    }
  });

  return () => {
    listeners.delete(listener);
  };
}
