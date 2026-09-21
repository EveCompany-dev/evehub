'use client';

import { type JSX } from 'react';
import type { TableViewMode } from '../lib/table-views';
import { DataTableGrid } from './DataTableGrid';
import { useSystemTable, type SystemTableKindName } from './useSystemTable';

// A stable array: the grid memoizes on it.
const HIDE_CLIENT = ['cliente'];

export interface ClientSubTableProps {
  id: string;
  kind: SystemTableKindName;
  title: string;
  hint?: string;
  clientId: string;
  modes: TableViewMode[];
  defaultMode: TableViewMode;
  /** Bumped by the page's shortcut buttons: adds a row and opens it. */
  addSignal?: number;
  addDefaults?: Record<string, unknown>;
  /** Rows changed here — tells the page to refresh the other views of the same table. */
  onRowsChange?: () => void;
}

/**
 * One of the client page's Notion-style sub-tables (Perfis sociais,
 * Referências, Postagens, Calendário de Conteúdo): the workspace's shared
 * table of that kind, narrowed to this client. New rows are stamped with the
 * client automatically, so nobody picks it by hand.
 */
export function ClientSubTable({ id, kind, title, hint, clientId, modes, defaultMode, addSignal, addDefaults, onRowsChange }: ClientSubTableProps): JSX.Element {
  const { table, setTable, error } = useSystemTable(kind);

  return (
    <section id={id} className="eve-clientpage__section">
      <div className="eve-clientpage__section-head">
        <h3>{title}</h3>
        {hint && <span className="eve-dim eve-clientpage__hint">{hint}</span>}
      </div>
      {error ? (
        <p className="eve-alert eve-alert--error">{error}</p>
      ) : !table ? (
        <p className="eve-dim">carregando...</p>
      ) : !table.columns.some((column) => column.type === 'client') ? (
        <p className="eve-dim">Esta tabela não tem mais uma coluna de Cliente, então não dá para filtrar por cliente. Recrie a coluna em Tabelas.</p>
      ) : (
        <DataTableGrid
          table={table}
          onTableChange={setTable}
          lockedClientId={clientId}
          hiddenKeys={HIDE_CLIENT}
          modes={modes}
          defaultMode={defaultMode}
          persistView={false}
          addSignal={addSignal}
          addDefaults={addDefaults}
          onRowsChange={onRowsChange}
        />
      )}
    </section>
  );
}
