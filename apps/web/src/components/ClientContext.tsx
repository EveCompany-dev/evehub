'use client';

import { createContext, useCallback, useContext, useMemo, useState, type JSX, type ReactNode } from 'react';

interface ClientContextValue {
  /** Globally selected client, or null for "todos". */
  activeClient: string | null;
  setActiveClient: (client: string | null) => void;
  /** Resolves the client a given widget should show. */
  resolveClient: (override: string | null | undefined) => string | null;
}

const ClientContext = createContext<ClientContextValue | null>(null);

/**
 * Plumbing for the global client selector.
 *
 * Empty in v0.0.3 on purpose — the selector itself arrives with the Notion
 * connector, when there are real clients to select. It exists now because
 * threading a client context through every connector after ten of them are
 * written is the expensive version of this change; doing it while there is one
 * widget costs nothing.
 */
export function ClientProvider({
  initialClient = null,
  children,
}: {
  initialClient?: string | null;
  children: ReactNode;
}): JSX.Element {
  const [activeClient, setActiveClient] = useState<string | null>(initialClient);

  // A widget pinned via clientOverride ignores the global selector entirely.
  const resolveClient = useCallback(
    (override: string | null | undefined) => override ?? activeClient,
    [activeClient],
  );

  const value = useMemo(
    () => ({ activeClient, setActiveClient, resolveClient }),
    [activeClient, resolveClient],
  );

  return <ClientContext.Provider value={value}>{children}</ClientContext.Provider>;
}

export function useClientContext(): ClientContextValue {
  const context = useContext(ClientContext);
  if (!context) throw new Error('useClientContext deve ser usado dentro de <ClientProvider>.');
  return context;
}
