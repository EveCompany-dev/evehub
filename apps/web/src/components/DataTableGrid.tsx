'use client';

import { useCallback, useEffect, useState, type JSX } from 'react';
import { useContextMenu } from './ContextMenu';
import type { DataColumn, DataColumnType, DataTableRowValue, DataTableSummary } from './data-table-types';
import { useEscapeToClose } from './useEscapeToClose';

export interface DataTableGridProps {
  table: DataTableSummary;
  onTableChange: (table: DataTableSummary) => void;
}

const TYPE_LABEL: Record<DataColumnType, string> = {
  text: 'Texto',
  number: 'Número',
  boolean: 'Sim/Não',
  date: 'Data',
  select: 'Seleção',
  client: 'Cliente',
};

const NEW_CLIENT_VALUE = '__new_client__';

type ColumnModalState = { mode: 'add' } | { mode: 'edit'; column: DataColumn } | null;

interface ClientOption {
  id: string;
  label: string;
}

function renderValue(value: unknown, type: DataColumnType): string {
  if (value === undefined || value === null || value === '') return '';
  if (type === 'boolean') return value ? '✓' : '—';
  return String(value);
}

/**
 * Real inline editing (click a cell, type, blur/Enter saves) — there's no
 * external source to conflict with local table data, so the connector
 * widgets' toggle-edit-mode/batch-save pattern doesn't apply here.
 *
 * Row/column management lives entirely in right-click menus (Office-style)
 * instead of a fixed toolbar — the one thing the user specifically flagged
 * as unfriendly about the first version of this screen.
 */
export function DataTableGrid({ table, onTableChange }: DataTableGridProps): JSX.Element {
  const [rows, setRows] = useState<DataTableRowValue[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<{ rowId: string; key: string } | null>(null);
  const [draft, setDraft] = useState('');
  const [columnModal, setColumnModal] = useState<ColumnModalState>(null);
  const [modalLabel, setModalLabel] = useState('');
  const [modalType, setModalType] = useState<DataColumnType>('text');
  const [modalOptions, setModalOptions] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [clients, setClients] = useState<ClientOption[]>([]);

  const rowMenu = useContextMenu();
  const columnMenu = useContextMenu();
  // No-op when nothing's open — setColumnModal(null) on an already-null state bails out.
  useEscapeToClose(() => setColumnModal(null));

  const loadRows = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch(`/api/tables/${table.id}/rows`, { cache: 'no-store' });
      const body = (await response.json().catch(() => ({}))) as { rows?: DataTableRowValue[]; error?: string };
      if (!response.ok || !body.rows) {
        setError(body.error ?? `HTTP ${response.status}`);
        return;
      }
      setRows(body.rows);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  }, [table.id]);

  useEffect(() => {
    // Mount/table-change fetch, same legitimate case as useWidgetData.ts's
    // initial fetch — loadRows sets loading synchronously before its first
    // await, which the rule can't distinguish from a synchronous effect body.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadRows();
  }, [loadRows]);

  const hasClientColumn = table.columns.some((column) => column.type === 'client');

  useEffect(() => {
    if (!hasClientColumn) return;
    // Same mount-fetch case as loadRows above — only runs when a 'client'
    // column actually exists, so tables without one skip the request.
    void (async () => {
      try {
        const response = await fetch('/api/scheduling/clients', { cache: 'no-store' });
        const body = (await response.json().catch(() => ({}))) as {
          clients?: { source: string; id: string; label: string }[];
        };
        if (response.ok && body.clients) {
          setClients(body.clients.filter((client) => client.source === 'local'));
        }
      } catch {
        // Non-critical: the client cell just falls back to showing raw ids.
      }
    })();
  }, [hasClientColumn]);

  const addRow = async () => {
    setError(null);
    try {
      const response = await fetch(`/api/tables/${table.id}/rows`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data: {} }),
      });
      const body = (await response.json().catch(() => ({}))) as { row?: DataTableRowValue; error?: string };
      if (!response.ok || !body.row) {
        setError(body.error ?? `HTTP ${response.status}`);
        return;
      }
      setRows((current) => [...current, body.row!]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const deleteRow = async (rowId: string) => {
    setError(null);
    try {
      const response = await fetch(`/api/tables/${table.id}/rows/${rowId}`, { method: 'DELETE' });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        setError(body.error ?? `HTTP ${response.status}`);
        return;
      }
      setRows((current) => current.filter((row) => row.id !== rowId));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const saveCell = async (rowId: string, key: string, value: unknown) => {
    setError(null);
    try {
      const response = await fetch(`/api/tables/${table.id}/rows/${rowId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data: { [key]: value } }),
      });
      const body = (await response.json().catch(() => ({}))) as { row?: DataTableRowValue; error?: string };
      if (!response.ok || !body.row) {
        setError(body.error ?? `HTTP ${response.status}`);
        return;
      }
      setRows((current) => current.map((row) => (row.id === rowId ? body.row! : row)));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const createClientInline = async (rowId: string, key: string) => {
    const name = window.prompt('Nome do novo cliente:');
    if (!name || !name.trim()) return;
    setError(null);
    try {
      const response = await fetch('/api/scheduling/clients', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim() }),
      });
      const body = (await response.json().catch(() => ({}))) as {
        client?: { id: string; name: string };
        error?: string;
      };
      if (!response.ok || !body.client) {
        setError(body.error ?? `HTTP ${response.status}`);
        return;
      }
      const client = body.client;
      setClients((current) => [...current, { id: client.id, label: client.name }].sort((a, b) => a.label.localeCompare(b.label)));
      await saveCell(rowId, key, client.id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const commitEdit = async () => {
    if (!editing) return;
    const column = table.columns.find((item) => item.key === editing.key);
    const value = column?.type === 'number' ? (draft === '' ? null : Number(draft)) : draft;
    await saveCell(editing.rowId, editing.key, value);
    setEditing(null);
  };

  const saveColumns = async (columns: (DataColumn | Omit<DataColumn, 'key'>)[]) => {
    setError(null);
    try {
      const response = await fetch(`/api/tables/${table.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ columns }),
      });
      const body = (await response.json().catch(() => ({}))) as { table?: DataTableSummary; error?: string };
      if (!response.ok || !body.table) {
        setError(body.error ?? `HTTP ${response.status}`);
        return;
      }
      onTableChange(body.table);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const removeColumn = async (key: string) => {
    if (table.columns.length <= 1) return;
    await saveColumns(table.columns.filter((column) => column.key !== key));
  };

  const openAddColumn = () => {
    setModalLabel('');
    setModalType('text');
    setModalOptions('');
    setColumnModal({ mode: 'add' });
  };

  const openEditColumn = (column: DataColumn) => {
    setModalLabel(column.label);
    setModalType(column.type);
    setModalOptions((column.options ?? []).join(', '));
    setColumnModal({ mode: 'edit', column });
  };

  const submitColumnModal = async () => {
    if (!columnModal || !modalLabel.trim()) return;
    const options = modalType === 'select' ? modalOptions.split(',').map((option) => option.trim()).filter(Boolean) : undefined;
    const entry = { label: modalLabel.trim(), type: modalType, ...(options ? { options } : {}) };

    const nextColumns =
      columnModal.mode === 'add'
        ? [...table.columns, entry]
        : table.columns.map((column) => (column.key === columnModal.column.key ? { ...entry, key: column.key } : column));

    await saveColumns(nextColumns);
    setColumnModal(null);
  };

  return (
    <div className="eve-datatable">
      {error && (
        <p className="eve-alert eve-alert--error">
          {error}{' '}
          <button type="button" className="eve-btn" onClick={() => void loadRows()}>
            Recarregar
          </button>
        </p>
      )}

      {loading ? (
        <p className="eve-dim">carregando...</p>
      ) : (
        <div className="eve-table-wrap">
          <table className="eve-table">
            <thead>
              <tr>
                {table.columns.map((column) => (
                  <th
                    key={column.key}
                    onContextMenu={(event) =>
                      columnMenu.open(event, [
                        { label: 'Editar coluna', onSelect: () => openEditColumn(column) },
                        { label: 'Adicionar coluna', onSelect: openAddColumn },
                        {
                          label: 'Remover coluna',
                          danger: true,
                          onSelect: () => void removeColumn(column.key),
                        },
                      ])
                    }
                  >
                    {column.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr
                  key={row.id}
                  onContextMenu={(event) =>
                    rowMenu.open(event, [
                      { label: 'Adicionar linha', onSelect: () => void addRow() },
                      { label: 'Remover linha', danger: true, onSelect: () => void deleteRow(row.id) },
                    ])
                  }
                >
                  {table.columns.map((column) => {
                    const isEditing = editing?.rowId === row.id && editing.key === column.key;
                    const value = row.data[column.key];

                    if (column.type === 'boolean') {
                      return (
                        <td key={column.key}>
                          <input
                            type="checkbox"
                            checked={Boolean(value)}
                            onChange={(event) => void saveCell(row.id, column.key, event.target.checked)}
                          />
                        </td>
                      );
                    }

                    if (column.type === 'select') {
                      return (
                        <td key={column.key}>
                          <select
                            className="eve-input"
                            value={String(value ?? '')}
                            onChange={(event) => void saveCell(row.id, column.key, event.target.value)}
                          >
                            <option value="">—</option>
                            {(column.options ?? []).map((option) => (
                              <option key={option} value={option}>
                                {option}
                              </option>
                            ))}
                          </select>
                        </td>
                      );
                    }

                    if (column.type === 'client') {
                      return (
                        <td key={column.key}>
                          <select
                            className="eve-input"
                            value={String(value ?? '')}
                            onChange={(event) => {
                              const next = event.target.value;
                              if (next === NEW_CLIENT_VALUE) {
                                void createClientInline(row.id, column.key);
                                return;
                              }
                              void saveCell(row.id, column.key, next || null);
                            }}
                          >
                            <option value="">—</option>
                            {clients.map((client) => (
                              <option key={client.id} value={client.id}>
                                {client.label}
                              </option>
                            ))}
                            <option value={NEW_CLIENT_VALUE}>+ Novo cliente...</option>
                          </select>
                        </td>
                      );
                    }

                    return (
                      <td key={column.key}>
                        {isEditing ? (
                          <input
                            className="eve-input"
                            type={column.type === 'number' ? 'number' : column.type === 'date' ? 'date' : 'text'}
                            autoFocus
                            value={draft}
                            onChange={(event) => setDraft(event.target.value)}
                            onBlur={() => void commitEdit()}
                            onKeyDown={(event) => {
                              if (event.key === 'Enter') void commitEdit();
                              if (event.key === 'Escape') setEditing(null);
                            }}
                          />
                        ) : (
                          <span
                            className="eve-cell"
                            onClick={() => {
                              setEditing({ rowId: row.id, key: column.key });
                              setDraft(String(value ?? ''));
                            }}
                          >
                            {renderValue(value, column.type) || <span className="eve-dim">&mdash;</span>}
                          </span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
              <tr>
                <td colSpan={table.columns.length} className="eve-datatable__addrow" onClick={() => void addRow()}>
                  + linha
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      )}

      {rowMenu.render()}
      {columnMenu.render()}

      {columnModal && (
        <div className="eve-modal-backdrop" onClick={() => setColumnModal(null)}>
          <div className="eve-modal" onClick={(event) => event.stopPropagation()}>
            <h2 className="eve-card__title">{columnModal.mode === 'add' ? 'Nova coluna' : 'Editar coluna'}</h2>

            <label className="eve-field">
              <span className="eve-field__label">Nome</span>
              <input className="eve-input" autoFocus value={modalLabel} onChange={(event) => setModalLabel(event.target.value)} />
            </label>

            <label className="eve-field">
              <span className="eve-field__label">Tipo</span>
              <select className="eve-input" value={modalType} onChange={(event) => setModalType(event.target.value as DataColumnType)}>
                {(Object.keys(TYPE_LABEL) as DataColumnType[]).map((type) => (
                  <option key={type} value={type}>
                    {TYPE_LABEL[type]}
                  </option>
                ))}
              </select>
            </label>

            {modalType === 'select' && (
              <label className="eve-field">
                <span className="eve-field__label">Opcoes (separadas por virgula)</span>
                <input className="eve-input" value={modalOptions} onChange={(event) => setModalOptions(event.target.value)} />
              </label>
            )}

            <div className="eve-profile__actions">
              <button type="button" className="eve-btn eve-btn--primary" onClick={() => void submitColumnModal()}>
                Salvar
              </button>
              <button type="button" className="eve-btn" onClick={() => setColumnModal(null)}>
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
