'use client';

import { useCallback, useEffect, useState, type JSX } from 'react';
import { useContextMenu } from './ContextMenu';
import { DataTableGrid } from './DataTableGrid';
import { TableWebhookModal } from './TableWebhookModal';
import type { DataTableSummary } from './data-table-types';

const NEW_TABLE_VALUE = '__new__';

export function TablesWorkspace(): JSX.Element {
  const [tables, setTables] = useState<DataTableSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [showWebhook, setShowWebhook] = useState(false);

  const menu = useContextMenu();

  const load = useCallback(async () => {
    const response = await fetch('/api/tables', { cache: 'no-store' });
    if (response.ok) {
      const body = (await response.json()) as { tables: DataTableSummary[] };
      setTables(body.tables);
      setSelectedId((current) => current ?? body.tables[0]?.id ?? null);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const createTable = async () => {
    if (!newName.trim()) return;
    const response = await fetch('/api/tables', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: newName.trim() }),
    });
    if (response.ok) {
      const body = (await response.json()) as { table: DataTableSummary };
      setTables((current) => [...current, body.table]);
      setSelectedId(body.table.id);
      setNewName('');
      setCreating(false);
    }
  };

  const deleteTable = async (tableId: string) => {
    const response = await fetch(`/api/tables/${tableId}`, { method: 'DELETE' });
    if (response.ok) {
      setTables((current) => current.filter((item) => item.id !== tableId));
      setSelectedId((current) => (current === tableId ? null : current));
    }
  };

  const selected = tables.find((table) => table.id === selectedId) ?? null;

  return (
    <div className="eve-tables">
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

      {!creating && tables.length === 0 && (
        <div className="eve-empty">
          <p className="eve-dim">Nenhuma tabela ainda. Use o menu acima para criar a primeira.</p>
        </div>
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
    </div>
  );
}
