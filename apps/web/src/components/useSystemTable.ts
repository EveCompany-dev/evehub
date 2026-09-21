'use client';

import { useEffect, useState } from 'react';
import type { DataTableSummary } from './data-table-types';

export type SystemTableKindName = 'content' | 'profiles' | 'references';

/** Loads (creating on first use) the workspace's Calendário de Conteúdo / Perfis / Referências table. */
export function useSystemTable(kind: SystemTableKindName): {
  table: DataTableSummary | null;
  setTable: (table: DataTableSummary) => void;
  error: string | null;
} {
  const [table, setTable] = useState<DataTableSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch(`/api/system-tables/${kind}`, { cache: 'no-store' });
        const body = (await response.json().catch(() => ({}))) as { table?: DataTableSummary; error?: string };
        if (cancelled) return;
        if (!response.ok || !body.table) setError(body.error ?? `HTTP ${response.status}`);
        else setTable(body.table);
      } catch (cause) {
        if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [kind]);

  return { table, setTable, error };
}
