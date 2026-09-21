'use client';

import type { JSX } from 'react';
import { clientAccent, readableOn } from '../lib/table-tags';
import { coverImage, rowTitle, titleColumn } from '../lib/table-views';
import type { DataColumn, DataTableRowValue, TableEnv } from './data-table-types';
import { ClientAvatar, ClientPill, TagPills } from './TagPill';

export interface GalleryViewProps {
  env: TableEnv;
  rows: DataTableRowValue[];
  clientLabels: Record<string, string>;
  onOpen: (rowId: string) => void;
  onAdd: () => void;
}

/** Up to this many non-title properties show on a card, tags/status first. */
const CARD_PROPS = 3;

function cardProps(columns: DataColumn[], titleKey: string | undefined, row: DataTableRowValue): DataColumn[] {
  const filled = columns.filter((column) => {
    if (column.key === titleKey) return false;
    const value = row.data[column.key];
    return value !== null && value !== undefined && value !== '' && !(Array.isArray(value) && value.length === 0);
  });
  const rank = (column: DataColumn): number =>
    column.type === 'select' ? 0 : column.type === 'multiselect' ? 1 : column.type === 'client' ? 2 : column.type === 'date' ? 3 : 4;
  return [...filled].sort((a, b) => rank(a) - rank(b)).slice(0, CARD_PROPS);
}

/**
 * Cards in a grid — the Notion "Marcas Atendidas" look: a cover (the row's
 * picture link, or its client's brand color and logo), the title, and the
 * colored tags underneath. Click a card to open the row as a page.
 */
export function GalleryView({ env, rows, clientLabels, onOpen, onAdd }: GalleryViewProps): JSX.Element {
  const columns = env.table.columns;
  const title = titleColumn(columns);
  const clientColumn = columns.find((column) => column.type === 'client');

  return (
    <div className="eve-gallery">
      {rows.map((row) => {
        const image = coverImage(columns, row);
        const clientId = clientColumn ? row.data[clientColumn.key] : null;
        const client = typeof clientId === 'string' ? env.clientById[clientId] : undefined;
        const accent = client ? clientAccent(client.label, client.color) : null;
        const props = cardProps(columns, title?.key, row);

        return (
          <div
            key={row.id}
            className="eve-gallery__card"
            role="button"
            tabIndex={0}
            onClick={() => onOpen(row.id)}
            onKeyDown={(event) => (event.key === 'Enter' || event.key === ' ') && (event.preventDefault(), onOpen(row.id))}
          >
            <div
              className="eve-gallery__cover"
              style={image ? { backgroundImage: `url("${image}")` } : accent ? { background: accent, color: readableOn(accent) } : undefined}
            >
              {!image && client && (client.logoUrl || client.icon) && <ClientAvatar client={client} size={56} />}
              {!image && !client && <span className="eve-gallery__initial">{rowTitle(columns, row, clientLabels).charAt(0).toUpperCase()}</span>}
            </div>
            <div className="eve-gallery__body">
              <strong className="eve-gallery__title">{rowTitle(columns, row, clientLabels)}</strong>
              {props.map((column) => (
                <div key={column.key} className="eve-gallery__prop">
                  {column.type === 'select' || column.type === 'multiselect' ? (
                    <TagPills column={column} value={row.data[column.key]} />
                  ) : column.type === 'client' ? (
                    (() => {
                      const id = row.data[column.key];
                      const found = typeof id === 'string' ? env.clientById[id] : undefined;
                      return found ? <ClientPill client={found} link /> : null;
                    })()
                  ) : (
                    <span className="eve-dim">{String(row.data[column.key])}</span>
                  )}
                </div>
              ))}
            </div>
          </div>
        );
      })}

      <button type="button" className="eve-gallery__add" onClick={onAdd}>
        + Novo
      </button>
      {rows.length === 0 && <p className="eve-dim eve-gallery__empty">Nenhuma linha para mostrar.</p>}
    </div>
  );
}
