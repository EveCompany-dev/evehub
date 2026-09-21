'use client';

import { useRef, useState, type JSX } from 'react';
import { columnFacets, isFacetColumn, withColumnFilter, type ColumnFilter, type TableFilterState } from '../lib/table-filters';
import type { TableViewMode } from '../lib/table-views';
import type { DataColumn, DataTableRowValue, TableClient } from './data-table-types';
import { Popover } from './Popover';
import { ClientPill, TagPill } from './TagPill';
import { Check, X } from '@eve/ui';

const VIEW_LABEL: Record<TableViewMode, string> = { table: 'Tabela', gallery: 'Galeria', calendar: 'Calendário' };

export interface TableToolbarProps {
  columns: DataColumn[];
  rows: DataTableRowValue[];
  clientById: Record<string, TableClient>;
  filter: TableFilterState;
  onFilterChange: (next: TableFilterState) => void;
  mode: TableViewMode;
  /** Views on offer; a single one hides the tabs. */
  modes: TableViewMode[];
  /** Search + tag filters. Off in the calendar, which always shows every entry. */
  showFilters: boolean;
  onModeChange: (mode: TableViewMode) => void;
  shown: number;
  total: number;
  /** Date columns to key the calendar by; more than one shows a picker. */
  dateColumns: DataColumn[];
  dateKey: string | null;
  onDateKeyChange: (key: string) => void;
}

/** What a filter chip says: "Status: Ativa, Ideia". */
function chipText(column: DataColumn, filter: ColumnFilter, facetLabel: (token: string) => string): string {
  if (filter.values && filter.values.length > 0) {
    const labels = filter.values.map(facetLabel);
    return `${column.label}: ${labels.length > 2 ? `${labels.slice(0, 2).join(', ')} +${labels.length - 2}` : labels.join(', ')}`;
  }
  return `${column.label}: “${filter.text ?? ''}”`;
}

export function TableToolbar({
  columns,
  rows,
  clientById,
  filter,
  onFilterChange,
  mode,
  modes,
  showFilters,
  onModeChange,
  shown,
  total,
  dateColumns,
  dateKey,
  onDateKeyChange,
}: TableToolbarProps): JSX.Element {
  const [addAnchor, setAddAnchor] = useState<DOMRect | null>(null);
  const [editing, setEditing] = useState<{ key: string; anchor: DOMRect } | null>(null);
  const addRef = useRef<HTMLButtonElement>(null);

  const clientLabels = Object.fromEntries(Object.entries(clientById).map(([id, client]) => [id, client.label]));
  const filtered = filter.filters.length > 0 || filter.search.trim() !== '';
  const editingColumn = editing ? columns.find((column) => column.key === editing.key) : undefined;

  const setColumnFilter = (key: string, next: ColumnFilter | null) => onFilterChange(withColumnFilter(filter, next, key));

  return (
    <div className="eve-toolbar">
      <div className="eve-toolbar__row">
        {modes.length > 1 && (
        <div className="eve-viewtabs" role="tablist" aria-label="Visualização">
          {modes.map((option) => (
            <button
              key={option}
              type="button"
              role="tab"
              aria-selected={mode === option}
              className={mode === option ? 'eve-viewtabs__tab is-active' : 'eve-viewtabs__tab'}
              onClick={() => onModeChange(option)}
            >
              {VIEW_LABEL[option]}
            </button>
          ))}
        </div>
        )}

        {mode === 'calendar' && dateColumns.length > 1 && (
          <select className="eve-input eve-toolbar__datekey" value={dateKey ?? ''} aria-label="Coluna de data do calendário" onChange={(event) => onDateKeyChange(event.target.value)}>
            {dateColumns.map((column) => (
              <option key={column.key} value={column.key}>
                por {column.label}
              </option>
            ))}
          </select>
        )}

        {showFilters && (
          <>
        <input
          className="eve-input eve-toolbar__search"
          type="search"
          placeholder="Buscar em todas as colunas…"
          value={filter.search}
          onChange={(event) => onFilterChange({ ...filter, search: event.target.value })}
        />

        <button
          ref={addRef}
          type="button"
          className="eve-btn"
          onClick={() => addRef.current && setAddAnchor(addRef.current.getBoundingClientRect())}
        >
          + Filtro
        </button>

        {filtered && (
          <button type="button" className="eve-btn" onClick={() => onFilterChange({ search: '', filters: [] })}>
            Limpar filtros
          </button>
        )}

        <span className="eve-dim eve-toolbar__count" aria-live="polite">
          {filtered ? `${shown} de ${total}` : `${total}`} linha{total === 1 ? '' : 's'}
        </span>
          </>
        )}
      </div>

      {showFilters && filter.filters.length > 0 && (
        <div className="eve-toolbar__chips">
          {filter.filters.map((item) => {
            const column = columns.find((candidate) => candidate.key === item.key);
            if (!column) return null;
            const facets = isFacetColumn(column) ? columnFacets(column, rows, clientLabels) : [];
            const facetLabel = (token: string) => facets.find((facet) => facet.token === token)?.label ?? token;
            return (
              <span key={item.key} className="eve-chip">
                <button
                  type="button"
                  className="eve-chip__label"
                  onClick={(event) => setEditing({ key: item.key, anchor: event.currentTarget.getBoundingClientRect() })}
                >
                  {chipText(column, item, facetLabel)}
                </button>
                <button type="button" className="eve-chip__x" aria-label={`Remover filtro de ${column.label}`} onClick={() => setColumnFilter(item.key, null)}>
                  <X size={14} aria-hidden="true" />
                </button>
              </span>
            );
          })}
        </div>
      )}

      {addAnchor && (
        <Popover anchor={addAnchor} onClose={() => setAddAnchor(null)} width={220}>
          <div className="eve-popover__list">
            {columns.map((column) => (
              <button
                key={column.key}
                type="button"
                className="eve-popover__item"
                onClick={() => {
                  setAddAnchor(null);
                  if (addRef.current) setEditing({ key: column.key, anchor: addRef.current.getBoundingClientRect() });
                }}
              >
                {column.label}
              </button>
            ))}
          </div>
        </Popover>
      )}

      {editing && editingColumn && (
        <FilterEditor
          column={editingColumn}
          rows={rows}
          clientById={clientById}
          clientLabels={clientLabels}
          anchor={editing.anchor}
          current={filter.filters.find((item) => item.key === editing.key)}
          onChange={(next) => setColumnFilter(editing.key, next)}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

interface FilterEditorProps {
  column: DataColumn;
  rows: DataTableRowValue[];
  clientById: Record<string, TableClient>;
  clientLabels: Record<string, string>;
  anchor: DOMRect;
  current: ColumnFilter | undefined;
  onChange: (next: ColumnFilter | null) => void;
  onClose: () => void;
}

/** Tick the values to keep (tags, status, client, yes/no) or type text to match (everything else). */
function FilterEditor({ column, rows, clientById, clientLabels, anchor, current, onChange, onClose }: FilterEditorProps): JSX.Element {
  if (!isFacetColumn(column)) {
    return (
      <Popover anchor={anchor} onClose={onClose} width={240}>
        <input
          className="eve-input eve-popover__search"
          autoFocus
          placeholder={`${column.label} contém…`}
          value={current?.text ?? ''}
          onChange={(event) => onChange({ key: column.key, text: event.target.value })}
          onKeyDown={(event) => event.key === 'Enter' && onClose()}
        />
      </Popover>
    );
  }

  const facets = columnFacets(column, rows, clientLabels);
  const picked = current?.values ?? [];
  const toggle = (token: string) => {
    const next = picked.includes(token) ? picked.filter((item) => item !== token) : [...picked, token];
    onChange({ key: column.key, values: next });
  };

  return (
    <Popover anchor={anchor} onClose={onClose} width={260}>
      <p className="eve-popover__title">{column.label}</p>
      <div className="eve-popover__list">
        {facets.map((facet) => {
          const on = picked.includes(facet.token);
          const client = column.type === 'client' ? clientById[facet.token] : undefined;
          return (
            <button key={facet.token} type="button" className={on ? 'eve-popover__item is-selected' : 'eve-popover__item'} onClick={() => toggle(facet.token)}>
              <span className="eve-popover__tick" aria-hidden="true">
                {on ? <Check size={14} aria-hidden="true" /> : null}
              </span>
              {client ? (
                <ClientPill client={client} />
              ) : column.type === 'select' || column.type === 'multiselect' ? (
                <TagPill name={facet.label} color={column.optionColors?.[facet.token]} />
              ) : (
                <span>{facet.label}</span>
              )}
              <span className="eve-dim eve-popover__count">{facet.count}</span>
            </button>
          );
        })}
        {facets.length === 0 && <p className="eve-dim eve-popover__empty">Nada para filtrar ainda.</p>}
      </div>
      {picked.length > 0 && (
        <button type="button" className="eve-popover__clear" onClick={() => onChange(null)}>
          Limpar
        </button>
      )}
    </Popover>
  );
}
