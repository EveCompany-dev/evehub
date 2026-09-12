'use client';

import { useCallback, useEffect, useState, type JSX } from 'react';
import { useContextMenu } from './ContextMenu';
import type { DataColumn, DataColumnType, DataTableRowValue, DataTableSummary } from './data-table-types';

export interface DataTableGridProps {
  table: DataTableSummary;
  onTableChange: (table: DataTableSummary) => void;
}

const TYPE_LABEL: Record<DataColumnType, string> = {
  text: 'Texto',
  number: 'Numero',
  boolean: 'Sim/Nao',
  date: 'Data',
  select: 'Selecao',
};

type ColumnModalState = { mode: 'add' } | { mode: 'edit'; column: DataColumn } | null;

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

  const rowMenu = useContextMenu();
  const columnMenu = useContextMenu();

  const loadRows = useCallback(async () => {
    setLoading(true);
    const response = await fetch(`/api/tables/${table.id}/rows`, { cache: 'no-store' });
    if (response.ok) setRows(((await response.json()) as { rows: DataTableRowValue[] }).rows);
    setLoading(false);
  }, [table.id]);

  useEffect(() => {
    // Mount/table-change fetch, same legitimate case as useWidgetData.ts's
    // initial fetch — loadRows sets loading synchronously before its first
    // await, which the rule can't distinguish from a synchronous effect body.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadRows();
  }, [loadRows]);

  const addRow = async () => {
    const response = await fetch(`/api/tables/${table.id}/rows`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data: {} }),
    });
    if (response.ok) {
      const body = (await response.json()) as { row: DataTableRowValue };
      setRows((current) => [...current, body.row]);
    }
  };

  const deleteRow = async (rowId: string) => {
    const response = await fetch(`/api/tables/${table.id}/rows/${rowId}`, { method: 'DELETE' });
    if (response.ok) setRows((current) => current.filter((row) => row.id !== rowId));
  };

  const saveCell = async (rowId: string, key: string, value: unknown) => {
    const response = await fetch(`/api/tables/${table.id}/rows/${rowId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data: { [key]: value } }),
    });
    if (response.ok) {
      const body = (await response.json()) as { row: DataTableRowValue };
      setRows((current) => current.map((row) => (row.id === rowId ? body.row : row)));
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
    const response = await fetch(`/api/tables/${table.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ columns }),
    });
    if (response.ok) {
      const body = (await response.json()) as { table: DataTableSummary };
      onTableChange(body.table);
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
