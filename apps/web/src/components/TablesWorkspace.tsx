'use client';

import { useCallback, useEffect, useState, type JSX } from 'react';
import { ClientsPanel } from './ClientsPanel';
import { useContextMenu } from './ContextMenu';
import { DataTableGrid } from './DataTableGrid';
import { TableWebhookModal } from './TableWebhookModal';
import type { DataColumn, DataTableRowValue, DataTableSummary } from './data-table-types';

const NEW_TABLE_VALUE = '__new__';

/** Wraps a field in quotes (doubling any internal quotes) only when it needs it — commas, quotes, or newlines. */
function csvField(value: unknown): string {
  const text = value === null || value === undefined ? '' : String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function toCsv(columns: DataColumn[], rows: DataTableRowValue[], clientLabels: Record<string, string> = {}): string {
  const header = columns.map((column) => csvField(column.label)).join(',');
  const lines = rows.map((row) =>
    columns
      .map((column) => {
        const raw = row.data[column.key];
        // A 'client' column stores a client id — export the human name
        // instead, otherwise every row is just a column of opaque cuids.
        const value = column.type === 'client' && typeof raw === 'string' ? (clientLabels[raw] ?? raw) : raw;
        return csvField(value);
      })
      .join(','),
  );
  // Leading BOM: Excel otherwise mis-detects the encoding for accented pt-BR text.
  return ['﻿' + header, ...lines].join('\n');
}

function downloadCsv(filename: string, content: string): void {
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export function TablesWorkspace(): JSX.Element {
  const [tables, setTables] = useState<DataTableSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [showWebhook, setShowWebhook] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<'tables' | 'clients'>('tables');

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
      setSelectedId((current) => current ?? body.tables![0]?.id ?? null);
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
      <div className="eve-tables__tabs">
        <button
          type="button"
          className={view === 'tables' ? 'eve-tables__tab is-active' : 'eve-tables__tab'}
          onClick={() => setView('tables')}
        >
          Tabelas
        </button>
        <button
          type="button"
          className={view === 'clients' ? 'eve-tables__tab is-active' : 'eve-tables__tab'}
          onClick={() => setView('clients')}
        >
          Clientes
        </button>
      </div>

      {view === 'clients' ? (
        <ClientsPanel />
      ) : (
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

                {selected && (
                  <button
                    type="button"
                    className="eve-btn eve-btn--icon"
                    aria-label="Acoes da tabela"
                    onClick={(event) =>
                      menu.open(event, [
                        { label: 'Exportar CSV', onSelect: () => void exportCsv(selected) },
                        { label: 'Automação (webhook)', onSelect: () => setShowWebhook(true) },
                        { label: 'Apagar tabela', danger: true, onSelect: () => void deleteTable(selected.id) },
                      ])
                    }
                  >
                    &#8942;
                  </button>
                )}
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
                <p className="eve-dim">Nenhuma tabela ainda. Use o menu acima para criar a primeira.</p>
              </div>
            )
          )}

          {selected && (
            <DataTableGrid
              key={selected.id}
              table={selected}
              onTableChange={(table) => setTables((current) => current.map((item) => (item.id === table.id ? table : item)))}
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
      )}
    </div>
  );
}
