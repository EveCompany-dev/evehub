'use client';

import { EveArch, strings } from '@eve/ui';
import { useEffect, type JSX } from 'react';

/**
 * Next.js route-segment error boundary: catches anything a page throws
 * (server or client) that a widget-level boundary can't reach, without
 * taking the rest of the app down — other tabs/pages are unaffected, and
 * `reset()` retries just this segment.
 */
export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }): JSX.Element {
  useEffect(() => {
    console.error('[app] page crashed:', error);
  }, [error]);

  return (
    <div className="eve-empty">
      <EveArch size={32} />
      <p className="eve-empty__title">{strings.errors.pageCrashed}</p>
      <p className="eve-dim">{error.message}</p>
      <button type="button" className="eve-btn eve-btn--primary" onClick={reset}>
        {strings.widget.retry}
      </button>
    </div>
  );
}
