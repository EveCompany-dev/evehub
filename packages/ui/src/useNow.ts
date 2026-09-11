'use client';

import { useSyncExternalStore } from 'react';

/**
 * Subscribes to the clock as an external store.
 *
 * The naive version (setState inside an effect, on an interval) causes
 * cascading renders and, worse, makes the server render "ha 3 min" while the
 * client renders something else moments later — a hydration mismatch. Here the
 * server snapshot is `null`, so time-dependent text simply is not rendered
 * until the client takes over.
 */
export function useNow(intervalMs = 30_000): number | null {
  return useSyncExternalStore(
    (onStoreChange) => {
      const timer = setInterval(onStoreChange, intervalMs);
      return () => clearInterval(timer);
    },
    // Bucketed so the snapshot is stable between ticks; returning a raw
    // Date.now() would make React see a new value on every render.
    () => Math.floor(Date.now() / intervalMs) * intervalMs,
    () => null,
  );
}
