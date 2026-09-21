'use client';

import Link from 'next/link';
import type { JSX, MouseEvent } from 'react';
import { clientAccent, readableOn, tagColorFor } from '../lib/table-tags';
import type { DataColumn, TableClient } from './data-table-types';

export interface TagPillProps {
  name: string;
  /** Palette key from the column's optionColors; missing = derived from the word. */
  color?: string;
  onRemove?: () => void;
}

/** A colored tag/status pill — the same look in the grid, gallery, calendar and filters. */
export function TagPill({ name, color, onRemove }: TagPillProps): JSX.Element {
  return (
    <span className="eve-pill" data-color={tagColorFor(name, color)}>
      <span className="eve-pill__text">{name}</span>
      {onRemove && (
        <button
          type="button"
          className="eve-pill__x"
          aria-label={`Remover ${name}`}
          onClick={(event) => {
            event.stopPropagation();
            onRemove();
          }}
        >
          ×
        </button>
      )}
    </span>
  );
}

/** Pills for a select/multiselect cell value, colored from the column. */
export function TagPills({ column, value }: { column: DataColumn; value: unknown }): JSX.Element | null {
  const names = Array.isArray(value) ? value.map(String) : value === null || value === undefined || value === '' ? [] : [String(value)];
  if (names.length === 0) return null;
  return (
    <span className="eve-pills">
      {names.map((name) => (
        <TagPill key={name} name={name} color={column.optionColors?.[name]} />
      ))}
    </span>
  );
}

/** Round brand mark: logo if there is one, else the emoji, else the color with the initial. */
export function ClientAvatar({ client, size = 18 }: { client: Pick<TableClient, 'label' | 'color' | 'icon' | 'logoUrl'>; size?: number }): JSX.Element {
  const accent = clientAccent(client.label, client.color);
  const style = { width: size, height: size, background: client.logoUrl ? '#fff' : accent, color: readableOn(accent), fontSize: Math.round(size * 0.55) };
  return (
    <span className="eve-avatar" style={style} aria-hidden="true">
      {client.logoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- user-uploaded brand logo served from /uploads
        <img src={client.logoUrl} alt="" />
      ) : (
        (client.icon ?? client.label.charAt(0).toUpperCase())
      )}
    </span>
  );
}

export interface ClientPillProps {
  client: TableClient;
  /** Render as a link to the client's own page (Clientes) instead of plain text. */
  link?: boolean;
}

/** A client relation: brand color/logo + name, linking to the client's page when asked. */
export function ClientPill({ client, link = false }: ClientPillProps): JSX.Element {
  const accent = clientAccent(client.label, client.color);
  const inner = (
    <>
      <ClientAvatar client={client} />
      <span className="eve-pill__text">{client.label}</span>
    </>
  );
  const style = { ['--pill' as string]: accent };
  if (!link) {
    return (
      <span className="eve-pill eve-pill--client" style={style}>
        {inner}
      </span>
    );
  }
  return (
    <Link
      href={`/clients/${client.id}`}
      className="eve-pill eve-pill--client eve-pill--link"
      style={style}
      title={`Abrir a página de ${client.label}`}
      onClick={(event: MouseEvent) => event.stopPropagation()}
    >
      {inner}
    </Link>
  );
}
