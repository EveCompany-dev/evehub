'use client';

import { useEffect, type JSX } from 'react';

/**
 * Fires only when the root layout itself throws (e.g. the session/DB lookup
 * in layout.tsx) — rare, but since a failure here means even the normal
 * layout couldn't render, this replaces the whole <html> and deliberately
 * uses inline styles only, no @eve/ui import: if something about the app's
 * own styling pipeline were implicated, this must still render legibly.
 */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }): JSX.Element {
  useEffect(() => {
    console.error('[app] root layout crashed:', error);
  }, [error]);

  return (
    <html lang="pt-BR">
      <body style={{ margin: 0, fontFamily: 'system-ui, sans-serif', background: '#1a1a1a', color: '#e6e6e6' }}>
        <div style={{ display: 'flex', minHeight: '100vh', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
          <div style={{ textAlign: 'center', maxWidth: 420 }}>
            <p style={{ fontSize: 18, fontWeight: 600, margin: '0 0 8px' }}>Eve Hub travou ao carregar.</p>
            <p style={{ color: '#9b9b9b', margin: '0 0 16px', fontSize: 13 }}>{error.message}</p>
            <button
              type="button"
              onClick={reset}
              style={{
                height: 32,
                padding: '0 16px',
                borderRadius: 999,
                border: '1px solid #3a3a3a',
                background: '#d94800',
                color: '#fff',
                cursor: 'pointer',
              }}
            >
              Tentar de novo
            </button>
          </div>
        </div>
      </body>
    </html>
  );
}
