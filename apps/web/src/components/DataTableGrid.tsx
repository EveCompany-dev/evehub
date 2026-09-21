'use client';

import { useCallback, useEffect, useMemo, useState, type JSX } from 'react';
import { toIsoDate } from '../lib/table-dates';
import { EMPTY_FILTERS, filterRows, type TableFilterState } from '../lib/table-filters';
import { TAG_COLORS, TAG_COLOR_LABEL, guessTagColor, hashTagColor, tagColorFor } from '../lib/table-tags';
import { dateColumns as pickDateColumns, type TableViewMode, type ViewPrefs } from '../lib/table-views';
import { CalendarView } from './CalendarView';
import { useContextMenu } from './ContextMenu';
import type { DataColumn, DataColumnType, DataTableRowValue, DataTableSummary, TableClient, TableEnv } from './data-table-types';
import { GalleryView } from './GalleryView';
import { RowDetailModal } from './RowDetailModal';
import { COLUMN_TYPE_ICON, COLUMN_TYPE_LABEL } from './table-column-meta';
import { TableCell } from './TableCell';
import { TableToolbar } from './TableToolbar';
import { useEscapeToClose } from './useEscapeToClose';

export interface DataTableGridProps {
  table: DataTableSummary;
  onTableChange: (table: DataTableSummary) => void;
}

type ColumnModalState = { mode: 'add' } | { mode: 'edit'; column: DataColumn } | null;

interface OptionDraft {
  name: string;
  color: string;
  /** Existing options keep their name: rows store it as text, so renaming would orphan every row using it. */
  locked: boolean;
}

const VIEW_MODES: TableViewMode[] = ['table', 'gallery', 'calendar'];

function prefsKey(tableId: string): string {
  return `eve.tableview.${tableId}`;
}

function readPrefs(tableId: string): ViewPrefs {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(prefsKey(tableId)) ?? 'null') as Partial<ViewPrefs> | null;
    if (parsed && VIEW_MODES.includes(parsed.mode as TableViewMode)) {
      return { mode: parsed.mode as TableViewMode, ...(typeof parsed.dateKey === 'string' ? { dateKey: parsed.dateKey } : {}) };
    }
  } catch {
    // Blocked or corrupt storage: fall back to the plain table.
  }
  return { mode: 'table' };
}

function writePrefs(tableId: string, prefs: ViewPrefs): void {
  try {
    window.localStorage.setItem(prefsKey(tableId), JSON.stringify(prefs));
  } catch {
    // Not worth surfacing — the view choice just won't be remembered.
  }
}

function isTagType(type: DataColumnType): boolean {
  return type === 'select' || type === 'multiselect';
}

/**
 * A table with three ways to look at it — grid, gallery and calendar — one
 * shared search/tag filter, and every row openable as its own page. Editing
 * is real inline editing (click, type, blur/Enter saves): there's no
 * external source to conflict with local table data, so the connector
 * widgets' toggle-edit-mode/batch-save pattern doesn't apply here.
 *
 * Row/column management lives in right-click menus (Office-style) rather
 * than a fixed toolbar.
 */
export function DataTableGrid({ table, onTableChange }: DataTableGridProps): JSX.Element {
  const [rows, setRows] = useState<DataTableRowValue[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [clients, setClients] = useState<TableClient[]>([]);
  const [filter, setFilter] = useState<TableFilterState>(EMPTY_FILTERS);
  const [prefs, setPrefs] = useState<ViewPrefs>(() => readPrefs(table.id));
  const [openRowId, setOpenRowId] = useState<string | null>(null);

  const [columnModal, setColumnModal] = useState<ColumnModalState>(null);
  const [modalLabel, setModalLabel] = useState('');
  const [modalType, setModalType] = useState<DataColumnType>('text');
  const [modalOptions, setModalOptions] = useState<OptionDraft[]>([]);
  const [newOption, setNewOption] = useState('');

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
          clients?: { source: string; id: string; label: string; color?: string | null; icon?: string | null; logoUrl?: string | null }[];
        };
        if (response.ok && body.clients) {
          setClients(
            body.clients
              .filter((client) => client.source === 'local')
              .map((client) => ({
                id: client.id,
                label: client.label,
                color: client.color ?? null,
                icon: client.icon ?? null,
                logoUrl: client.logoUrl ?? null,
              })),
          );
        }
      } catch {
        // Non-critical: relation cells just show "cliente removido" until the list loads.
      }
    })();
  }, [hasClientColumn]);

  const clientById = useMemo(() => Object.fromEntries(clients.map((client) => [client.id, client])), [clients]);
  const clientLabels = useMemo(() => Object.fromEntries(clients.map((client) => [client.id, client.label])), [clients]);

  const dateColumns = useMemo(() => pickDateColumns(table.columns), [table.columns]);
  const dateColumn = dateColumns.find((column) => column.key === prefs.dateKey) ?? dateColumns[0] ?? null;

  const updatePrefs = (next: ViewPrefs) => {
    setPrefs(next);
    writePrefs(table.id, next);
  };

  const visibleRows = useMemo(() => filterRows(rows, table.columns, filter, clientLabels), [rows, table.columns, filter, clientLabels]);

  // --- row + cell operations ------------------------------------------------------

  const addRow = async (data: Record<string, unknown> = {}, open = false) => {
    setError(null);
    try {
      const response = await fetch(`/api/tables/${table.id}/rows`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data }),
      });
      const body = (await response.json().catch(() => ({}))) as { row?: DataTableRowValue; error?: string };
      if (!response.ok || !body.row) {
        setError(body.error ?? `HTTP ${response.status}`);
        return;
      }
      setRows((current) => [...current, body.row!]);
      if (open) setOpenRowId(body.row.id);
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

  const saveCell = useCallback(
    async (rowId: string, key: string, value: unknown) => {
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
    },
    [table.id],
  );

  const saveColumns = useCallback(
    async (columns: (DataColumn | Omit<DataColumn, 'key'>)[]) => {
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
    },
    [table.id, onTableChange],
  );

  const addOption = useCallback(
    async (columnKey: string, name: string) => {
      const column = table.columns.find((item) => item.key === columnKey);
      if (!column || (column.options ?? []).includes(name)) return;
      const color = guessTagColor(name) ?? hashTagColor(name);
      await saveColumns(
        table.columns.map((item) =>
          item.key === columnKey ? { ...item, options: [...(item.options ?? []), name], optionColors: { ...item.optionColors, [name]: color } } : item,
        ),
      );
    },
    [table.columns, saveColumns],
  );

  const createClient = useCallback(async (name: string): Promise<TableClient | null> => {
    setError(null);
    try {
      const response = await fetch('/api/scheduling/clients', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      const body = (await response.json().catch(() => ({}))) as {
        client?: { id: string; name: string; color?: string | null; icon?: string | null; logoUrl?: string | null };
        error?: string;
      };
      if (!response.ok || !body.client) {
        setError(body.error ?? `HTTP ${response.status}`);
        return null;
      }
      const created: TableClient = {
        id: body.client.id,
        label: body.client.name,
        color: body.client.color ?? null,
        icon: body.client.icon ?? null,
        logoUrl: body.client.logoUrl ?? null,
      };
      setClients((current) => [...current, created].sort((a, b) => a.label.localeCompare(b.label)));
      return created;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      return null;
    }
  }, []);

  const env: TableEnv = useMemo(
    () => ({ table, clients, clientById, saveCell, addOption, createClient }),
    [table, clients, clientById, saveCell, addOption, createClient],
  );

  // --- column management -----------------------------------------------------------

  const removeColumn = async (key: string) => {
    if (table.columns.length <= 1) return;
    await saveColumns(table.columns.filter((column) => column.key !== key));
  };

  const openAddColumn = (type: DataColumnType = 'text') => {
    setModalLabel('');
    setModalType(type);
    setModalOptions([]);
    setNewOption('');
    setColumnModal({ mode: 'add' });
  };

  const openEditColumn = (column: DataColumn) => {
    setModalLabel(column.label);
    setModalType(column.type);
    setModalOptions((column.options ?? []).map((name) => ({ name, color: tagColorFor(name, column.optionColors?.[name]), locked: true })));
    setNewOption('');
    setColumnModal({ mode: 'edit', column });
  };

  const addOptionDraft = () => {
    const name = newOption.trim();
    if (!name || modalOptions.some((option) => option.name === name)) return;
    setModalOptions((current) => [...current, { name, color: guessTagColor(name) ?? hashTagColor(name), locked: false }]);
    setNewOption('');
  };

  const submitColumnModal = async () => {
    if (!columnModal || !modalLabel.trim()) return;

    // A half-typed option ("Ideia" in the box, Save clicked) still counts.
    const pending = newOption.trim();
    const drafts =
      pending && !modalOptions.some((option) => option.name === pending)
        ? [...modalOptions, { name: pending, color: guessTagColor(pending) ?? hashTagColor(pending), locked: false }]
        : modalOptions;

    const tags = isTagType(modalType)
      ? { options: drafts.map((option) => option.name), optionColors: Object.fromEntries(drafts.map((option) => [option.name, option.color])) }
      : {};
    const entry = { label: modalLabel.trim(), type: modalType, ...tags };

    const nextColumns =
      columnModal.mode === 'add'
        ? [...table.columns, entry]
        : table.columns.map((column) => (column.key === columnModal.column.key ? { ...entry, key: column.key } : column));

    await saveColumns(nextColumns);
    setColumnModal(null);
  };

  const openRow = openRowId ? (rows.find((row) => row.id === openRowId) ?? null) : null;

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

      <TableToolbar
        columns={table.columns}
        rows={rows}
        clientById={clientById}
        filter={filter}
        onFilterChange={setFilter}
        mode={prefs.mode}
        onModeChange={(mode) => updatePrefs({ ...prefs, mode })}
        shown={visibleRows.length}
        total={rows.length}
        dateColumns={dateColumns}
        dateKey={dateColumn?.key ?? null}
        onDateKeyChange={(dateKey) => updatePrefs({ ...prefs, dateKey })}
      />

      {loading ? (
        <p className="eve-dim">carregando...</p>
      ) : prefs.mode === 'gallery' ? (
        <GalleryView env={env} rows={visibleRows} clientLabels={clientLabels} onOpen={setOpenRowId} onAdd={() => void addRow({}, true)} />
      ) : prefs.mode === 'calendar' ? (
        dateColumn ? (
          <CalendarView
            key={dateColumn.key}
            env={env}
            rows={visibleRows}
            dateColumn={dateColumn}
            clientLabels={clientLabels}
            onOpen={setOpenRowId}
            onAddOnDay={(date) => void addRow({ [dateColumn.key]: toIsoDate(date) }, true)}
          />
        ) : (
          <div className="eve-empty">
            <p className="eve-dim">O calendário precisa de uma coluna do tipo Data para saber onde colocar cada linha.</p>
            <button type="button" className="eve-btn eve-btn--primary" onClick={() => openAddColumn('date')}>
              Adicionar coluna de data
            </button>
          </div>
        )
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
                        { label: 'Adicionar coluna', onSelect: () => openAddColumn() },
                        {
                          label: 'Remover coluna',
                          danger: true,
                          onSelect: () => void removeColumn(column.key),
                        },
                      ])
                    }
                  >
                    <span className="eve-th__icon" aria-hidden="true">
                      {COLUMN_TYPE_ICON[column.type]}
                    </span>{' '}
                    {column.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visibleRows.map((row) => (
                <tr
                  key={row.id}
                  onContextMenu={(event) =>
                    rowMenu.open(event, [
                      { label: 'Abrir linha', onSelect: () => setOpenRowId(row.id) },
                      { label: 'Adicionar linha', onSelect: () => void addRow() },
                      { label: 'Remover linha', danger: true, onSelect: () => void deleteRow(row.id) },
                    ])
                  }
                >
                  {table.columns.map((column, index) => (
                    <td key={column.key}>
                      <div className="eve-datatable__cellwrap">
                        <TableCell column={column} value={row.data[column.key]} rowId={row.id} env={env} variant="grid" />
                        {index === 0 && (
                          <button type="button" className="eve-datatable__open" aria-label="Abrir linha" title="Abrir linha" onClick={() => setOpenRowId(row.id)}>
                            ⤢
                          </button>
                        )}
                      </div>
                    </td>
                  ))}
                </tr>
              ))}
              {visibleRows.length === 0 && rows.length > 0 && (
                <tr>
                  <td colSpan={table.columns.length} className="eve-dim">
                    Nenhuma linha bate com os filtros.
                  </td>
                </tr>
              )}
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

      {openRow && (
        <RowDetailModal env={env} row={openRow} clientLabels={clientLabels} onClose={() => setOpenRowId(null)} onDelete={(rowId) => void deleteRow(rowId)} />
      )}

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
                {(Object.keys(COLUMN_TYPE_LABEL) as DataColumnType[]).map((type) => (
                  <option key={type} value={type}>
                    {COLUMN_TYPE_LABEL[type]}
                  </option>
                ))}
              </select>
            </label>

            {isTagType(modalType) && (
              <div className="eve-field">
                <span className="eve-field__label">Opções e cores</span>
                <div className="eve-optioneditor">
                  {modalOptions.map((option) => (
                    <div key={option.name} className="eve-optioneditor__row">
                      <select
                        className="eve-optioneditor__color"
                        data-color={option.color}
                        aria-label={`Cor de ${option.name}`}
                        value={option.color}
                        onChange={(event) =>
                          setModalOptions((current) => current.map((item) => (item.name === option.name ? { ...item, color: event.target.value } : item)))
                        }
                      >
                        {TAG_COLORS.map((color) => (
                          <option key={color} value={color}>
                            {TAG_COLOR_LABEL[color]}
                          </option>
                        ))}
                      </select>
                      <span className="eve-pill" data-color={option.color}>
                        <span className="eve-pill__text">{option.name}</span>
                      </span>
                      <button
                        type="button"
                        className="eve-btn eve-btn--icon"
                        aria-label={`Remover ${option.name}`}
                        onClick={() => setModalOptions((current) => current.filter((item) => item.name !== option.name))}
                      >
                        ×
                      </button>
                    </div>
                  ))}
                  <div className="eve-optioneditor__row">
                    <input
                      className="eve-input"
                      placeholder="Nova opção…"
                      value={newOption}
                      onChange={(event) => setNewOption(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                          event.preventDefault();
                          addOptionDraft();
                        }
                      }}
                    />
                    <button type="button" className="eve-btn" onClick={addOptionDraft}>
                      Adicionar
                    </button>
                  </div>
                </div>
                <span className="eve-dim eve-field__hint">
                  Opções que já existem mantêm o nome (as linhas usam esse texto); você pode mudar a cor ou remover da lista.
                </span>
              </div>
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
