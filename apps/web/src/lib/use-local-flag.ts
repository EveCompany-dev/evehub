'use client';

import { useCallback, useState } from 'react';

/**
 * A boolean widget option kept in localStorage — a per-browser preference, not
 * shared data. Only meant for client-only (`ssr: false`) widgets, since the
 * initial read touches `window`.
 */
export function useLocalFlag(key: string): [boolean, (next: boolean) => void] {
  const [value, setValue] = useState(() => {
    try {
      return window.localStorage.getItem(key) === '1';
    } catch {
      return false;
    }
  });

  const set = useCallback(
    (next: boolean) => {
      setValue(next);
      try {
        window.localStorage.setItem(key, next ? '1' : '0');
      } catch {
        // Blocked storage: the option just won't survive a reload.
      }
    },
    [key],
  );

  return [value, set];
}
