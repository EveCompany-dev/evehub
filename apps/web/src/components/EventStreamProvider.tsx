'use client';

import { createContext, useCallback, useContext, useEffect, useRef, type JSX, type ReactNode } from 'react';

type Callback = () => void;

interface EventStreamValue {
  subscribe: (instanceId: string, callback: Callback) => () => void;
}

const EventStreamContext = createContext<EventStreamValue | null>(null);

export interface EventStreamProviderProps {
  children: ReactNode;
  /**
   * false = the stream stays connected (so flipping this back on doesn't
   * need a reconnect) but stops waking up widgets. Manual "sincronizar
   * agora" still hits the API directly and is unaffected.
   */
  liveUpdates?: boolean;
}

/**
 * One EventSource for the whole tab, fanned out by instance id.
 *
 * A stream per widget would mean a Redis subscriber per widget per tab; this
 * keeps it at one connection no matter how many modules are on the grid.
 */
export function EventStreamProvider({ children, liveUpdates = true }: EventStreamProviderProps): JSX.Element {
  const listeners = useRef(new Map<string, Set<Callback>>());
  const liveUpdatesRef = useRef(liveUpdates);

  useEffect(() => {
    liveUpdatesRef.current = liveUpdates;
  }, [liveUpdates]);

  useEffect(() => {
    const source = new EventSource('/api/events');

    const onConnector = (event: MessageEvent<string>) => {
      if (!liveUpdatesRef.current) return;
      try {
        const payload = JSON.parse(event.data) as { instanceId?: string };
        if (!payload.instanceId) return;
        listeners.current.get(payload.instanceId)?.forEach((callback) => callback());
      } catch {
        // A malformed frame must not kill the stream.
      }
    };

    source.addEventListener('connector', onConnector as EventListener);

    return () => {
      source.removeEventListener('connector', onConnector as EventListener);
      source.close();
    };
  }, []);

  const subscribe = useCallback((instanceId: string, callback: Callback) => {
    const map = listeners.current;
    const set = map.get(instanceId) ?? new Set<Callback>();
    set.add(callback);
    map.set(instanceId, set);

    return () => {
      set.delete(callback);
      if (set.size === 0) map.delete(instanceId);
    };
  }, []);

  return <EventStreamContext.Provider value={{ subscribe }}>{children}</EventStreamContext.Provider>;
}

/** Runs `onUpdate` whenever this connector instance reports new data. */
export function useConnectorEvents(instanceId: string, onUpdate: Callback): void {
  const context = useContext(EventStreamContext);
  const handler = useRef(onUpdate);

  // Writing a ref during render is not allowed; keep the latest callback in
  // an effect so the subscription below never has to re-subscribe just
  // because the caller passed a new closure.
  useEffect(() => {
    handler.current = onUpdate;
  }, [onUpdate]);

  useEffect(() => {
    if (!context) return;
    return context.subscribe(instanceId, () => handler.current());
  }, [context, instanceId]);
}
