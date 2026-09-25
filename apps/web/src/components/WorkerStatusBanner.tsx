'use client';

import { strings } from '@eve/ui';
import { useEffect, useState, type JSX } from 'react';

const CHECK_EVERY_MS = 60_000;

/**
 * Warns when the worker that publishes posts is down (no heartbeat in the
 * last few minutes): scheduling still saves, but nothing would go out. Stays
 * silent when the status can't be read at all (no access, network hiccup) —
 * a false alarm would teach people to ignore it.
 */
export function WorkerStatusBanner(): JSX.Element | null {
  const [running, setRunning] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    const check = async () => {
      try {
        const response = await fetch('/api/scheduling/worker-status', { cache: 'no-store' });
        if (!response.ok) return;
        const body = (await response.json()) as { running?: boolean };
        if (!cancelled && typeof body.running === 'boolean') setRunning(body.running);
      } catch {
        // Unknown is not "down".
      }
    };
    void check();
    const timer = setInterval(() => void check(), CHECK_EVERY_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  if (running !== false) return null;
  return (
    <p className="eve-alert eve-alert--error" role="alert">
      {strings.scheduling.workerDown}
    </p>
  );
}
