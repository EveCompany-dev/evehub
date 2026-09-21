'use client';

import type { JSX } from 'react';
import { rowTitle, titleColumn } from '../lib/table-views';
import type { DataTableRowValue, TableEnv } from './data-table-types';
import { ColumnTypeIcon } from './table-column-meta';
import { TableCell } from './TableCell';
import { useEscapeToClose } from './useEscapeToClose';
import { X } from '@eve/ui';

export interface RowDetailModalProps {
  env: TableEnv;
  row: DataTableRowValue;
  clientLabels: Record<string, string>;
  onClose: () => void;
  onDelete: (rowId: string) => void;
}

/**
 * A row as a page (Notion-style): its title, then every property as an
 * editable field. This is where long text — a post's script, a caption —
 * gets room to breathe, instead of being squeezed into a grid cell.
 */
export function RowDetailModal({ env, row, clientLabels, onClose, onDelete }: RowDetailModalProps): JSX.Element {
  useEscapeToClose(onClose);
  const columns = env.table.columns;
  const title = titleColumn(columns);
  const others = columns.filter((column) => column.key !== title?.key);
  // Long text goes below the short properties, full width.
  const shortProps = others.filter((column) => column.type !== 'text');
  const longProps = others.filter((column) => column.type === 'text');

  return (
    <div className="eve-modal-backdrop" onClick={onClose}>
      <div className="eve-modal eve-rowpage" role="dialog" aria-label={rowTitle(columns, row, clientLabels)} onClick={(event) => event.stopPropagation()}>
        <div className="eve-rowpage__bar">
          <span className="eve-dim">{env.table.name}</span>
          <span className="eve-rowpage__bar-actions">
            <button
              type="button"
              className="eve-btn eve-btn--danger"
              onClick={() => {
                onDelete(row.id);
                onClose();
              }}
            >
              Remover linha
            </button>
            <button type="button" className="eve-btn eve-btn--icon" aria-label="Fechar" onClick={onClose}>
              <X size={14} aria-hidden="true" />
            </button>
          </span>
        </div>

        {title ? (
          <div className="eve-rowpage__title">
            <TableCell column={title} value={row.data[title.key]} rowId={row.id} env={env} variant="form" single />
          </div>
        ) : (
          <h2 className="eve-card__title">{rowTitle(columns, row, clientLabels)}</h2>
        )}

        <div className="eve-rowpage__props">
          {shortProps.map((column) => (
            <div key={column.key} className="eve-rowpage__prop">
              <span className="eve-rowpage__label" title={column.label}>
                <ColumnTypeIcon type={column.type} /> {column.label}
              </span>
              <span className="eve-rowpage__value">
                <TableCell column={column} value={row.data[column.key]} rowId={row.id} env={env} variant="form" />
              </span>
            </div>
          ))}
        </div>

        {longProps.map((column) => (
          <div key={column.key} className="eve-rowpage__long">
            <h3 className="eve-rowpage__long-label">{column.label}</h3>
            <TableCell column={column} value={row.data[column.key]} rowId={row.id} env={env} variant="form" />
          </div>
        ))}
      </div>
    </div>
  );
}
