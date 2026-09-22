'use client';

import { useCallback, useEffect, useState, type JSX } from 'react';
import { toCsv } from '../lib/table-csv';
import { useContextMenu } from './ContextMenu';
import { DataTableGrid } from './DataTableGrid';
import { ImportWizard } from './ImportWizard';
import { TableWebhookModal } from './TableWebhookModal';
import type { DataTableRowValue, DataTableSummary } from './data-table-types';
import { EllipsisVertical } from '@eve/ui';

const NEW_TABLE_VALUE = '__new__';

function downloadCsv(filename: string, content: string): void {
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export interface TablesWorkspaceProps {
  /** Table to open first (deep link from a client page: /tables?table=<id>). */
  initialTableId?: string;
}

export function TablesWorkspace({ initialTableId }: TablesWorkspaceProps = {}): JSX.Element {
  const [tables, setTables] = useState<DataTableSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(initialTableId ?? null);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [showWebhook, setShowWebhook] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showImport, setShowImport] = useState(false);

  const menu = useContextMenu();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/tables', { cache: 'no-store' });
      const body = (await response.json().catch(() => ({}))) as { tables?: DataTableSummary[]; error?: string };
      if (!response.ok || !body.tables) {
        setError(body.error ?? `HTTP ${response.status}`);
        return;
      }
      setTables(body.tables);
      // Keep the current/deep-linked table when it still exists, else fall back to the first.
      setSelectedId((current) => (current && body.tables!.some((table) => table.id === current) ? current : (body.tables![0]?.id ?? null)));
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // Mount fetch — every setState inside load() happens after an await,
    // never synchronously during the effect (same case as useWidgetData.ts).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const createTable = async () => {
    if (!newName.trim()) return;
    setError(null);
    try {
      const response = await fetch('/api/tables', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newName.trim() }),
      });
      const body = (await response.json().catch(() => ({}))) as { table?: DataTableSummary; error?: string };
      if (!response.ok || !body.table) {
        setError(body.error ?? `HTTP ${response.status}`);
        return;
      }
      setTables((current) => [...current, body.table!]);
      setSelectedId(body.table.id);
      setNewName('');
      setCreating(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const deleteTable = async (tableId: string) => {
    setError(null);
    try {
      const response = await fetch(`/api/tables/${tableId}`, { method: 'DELETE' });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        setError(body.error ?? `HTTP ${response.status}`);
        return;
      }
      setTables((current) => current.filter((item) => item.id !== tableId));
      setSelectedId((current) => (current === tableId ? null : current));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const exportCsv = async (table: DataTableSummary) => {
    setError(null);
    try {
      const response = await fetch(`/api/tables/${table.id}/rows`, { cache: 'no-store' });
      const body = (await response.json().catch(() => ({}))) as { rows?: DataTableRowValue[]; error?: string };
      if (!response.ok || !body.rows) {
        setError(body.error ?? `HTTP ${response.status}`);
        return;
      }

      let clientLabels: Record<string, string> = {};
      if (table.columns.some((column) => column.type === 'client')) {
        const clientsResponse = await fetch('/api/scheduling/clients', { cache: 'no-store' });
        const clientsBody = (await clientsResponse.json().catch(() => ({}))) as {
          clients?: { id: string; label: string }[];
        };
        clientLabels = Object.fromEntries((clientsBody.clients ?? []).map((client) => [client.id, client.label]));
      }

      downloadCsv(`${table.name}.csv`, toCsv(table.columns, body.rows, clientLabels));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const selected = tables.find((table) => table.id === selectedId) ?? null;

  return (
    <div className="eve-tables">
      <>
          <div className="eve-tables__head">
            {creating ? (
              <span className="eve-tables__new">
                <input
                  className="eve-input"
                  autoFocus
                  placeholder="Nome da tabela"
                  value={newName}
                  onChange={(event) => setNewName(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') void createTable();
                    if (event.key === 'Escape') setCreating(false);
                  }}
                />
                <button type="button" className="eve-btn eve-btn--primary" onClick={() => void createTable()}>
                  Criar
                </button>
                <button type="button" className="eve-btn" onClick={() => setCreating(false)}>
                  Cancelar
                </button>
              </span>
            ) : (
              <>
                <select
                  className="eve-input eve-tables__picker"
                  value={selectedId ?? ''}
                  onChange={(event) => {
                    if (event.target.value === NEW_TABLE_VALUE) setCreating(true);
                    else setSelectedId(event.target.value);
                  }}
                >
                  {tables.length === 0 && <option value="">Nenhuma tabela ainda</option>}
                  {tables.map((table) => (
                    <option key={table.id} value={table.id}>
                      {table.name}
                    </option>
                  ))}
                  <option value={NEW_TABLE_VALUE}>+ Nova tabela...</option>
                </select>

                <button
                  type="button"
                  className="eve-btn eve-btn--icon"
                  aria-label="Ações da tabela"
                  onClick={(event) =>
                    menu.open(event, [
                      { label: 'Importar CSV / Notion', onSelect: () => setShowImport(true) },
                      ...(selected
                        ? [
                            { label: 'Exportar CSV', onSelect: () => void exportCsv(selected) },
                            { label: 'Automação (webhook)', onSelect: () => setShowWebhook(true) },
                            { label: 'Apagar tabela', danger: true, onSelect: () => void deleteTable(selected.id) },
                          ]
                        : []),
                    ])
                  }
                >
                  <EllipsisVertical size={14} aria-hidden="true" />
                </button>
              </>
            )}
          </div>

          {menu.render()}

          {error && <p className="eve-alert eve-alert--error">{error}</p>}

          {loading ? (
            <p className="eve-dim">carregando...</p>
          ) : (
            !creating &&
            tables.length === 0 && (
              <div className="eve-empty">
                <p className="eve-dim">Nenhuma tabela ainda. Crie a primeira pelo seletor acima, ou importe um CSV (ou o .zip do Notion) pelo menu ⋮.</p>
              </div>
            )
          )}

          {selected && (
            // Just the table: no gallery/calendar tabs, search, filters or row count on this page.
            <DataTableGrid
              key={selected.id}
              table={selected}
              onTableChange={(table) => setTables((current) => current.map((item) => (item.id === table.id ? table : item)))}
              modes={['table']}
              persistView={false}
              showFilters={false}
            />
          )}

          {showImport && (
            <ImportWizard
              onClose={() => setShowImport(false)}
              onImported={(created) => {
                setTables((current) => [...current, ...created]);
                setSelectedId(created[created.length - 1]!.id);
                setShowImport(false);
              }}
            />
          )}

          {selected && showWebhook && (
            <TableWebhookModal
              table={selected}
              onTableChange={(table) => setTables((current) => current.map((item) => (item.id === table.id ? table : item)))}
              onClose={() => setShowWebhook(false)}
            />
          )}
      </>
    </div>
  );
}
