'use client';

import { useEffect, useRef, useState, type JSX, type ReactNode } from 'react';
import { formatRelativeTime } from './relative-time';
import { StatusPill, type ConnectorStatusValue } from './StatusPill';
import { strings } from './strings';
import { useNow } from './useNow';
import { EllipsisVertical, Pencil, X } from './icons';

export interface WidgetAction {
  label: string;
  onSelect: () => void;
  /** Rendered in the brick colour, for destructive actions. */
  danger?: boolean;
}

export interface WidgetShellProps {
  title: string;
  status: ConnectorStatusValue;
  statusMessage?: string | null;
  lastSyncedAt?: string | null;
  readOnly?: boolean;
  actions?: WidgetAction[];
  footerExtra?: ReactNode;
  children: ReactNode;

  /**
   * Edicao do widget inteiro, num unico botao no cabecalho.
   *
   * Substitui o lapis por celula: com uma tabela de vinte linhas, vinte lapis
   * viram ruido visual. Passe `editable` para o connector que sabe escrever e
   * o proprio widget alterna suas celulas para inputs.
   */
  editable?: boolean;
  editing?: boolean;
  onToggleEdit?: () => void;
}

/**
 * The common chrome every connector widget sits inside: title, health, the
 * three-dot menu, and the "atualizado ha X min" footer. The connector owns
 * only the body.
 */
export function WidgetShell({
  title,
  status,
  statusMessage,
  lastSyncedAt,
  readOnly = false,
  actions = [],
  footerExtra,
  children,
  editable = false,
  editing = false,
  onToggleEdit,
}: WidgetShellProps): JSX.Element {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // null on the server and on the very first client render, then it ticks.
  const now = useNow();
  const relative = now === null ? null : formatRelativeTime(lastSyncedAt ?? null, now);

  useEffect(() => {
    if (!menuOpen) return;

    const onPointerDown = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenuOpen(false);
    };

    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [menuOpen]);

  return (
    <section className="eve-widget">
      <header className="eve-widget__header">
        <h3 className="eve-widget__title">{title}</h3>
        <StatusPill status={status} message={statusMessage} />

        {editable && onToggleEdit && (
          <button
            type="button"
            className={editing ? 'eve-btn eve-btn--icon is-active eve-no-drag' : 'eve-btn eve-btn--icon eve-no-drag'}
            aria-pressed={editing}
            title={editing ? strings.edit.cancel : strings.edit.edit}
            aria-label={editing ? strings.edit.cancel : strings.edit.edit}
            onClick={onToggleEdit}
          >
            {editing ? <X size={14} aria-hidden="true" /> : <Pencil size={14} aria-hidden="true" />}
          </button>
        )}

        {actions.length > 0 && (
          // eve-no-drag keeps the grid from treating a menu click as a drag.
          <div className="eve-widget__menu eve-no-drag" ref={menuRef}>
            <button
              type="button"
              className="eve-btn eve-btn--icon"
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              aria-label="Acoes do widget"
              onClick={() => setMenuOpen((open) => !open)}
            >
              <EllipsisVertical size={14} aria-hidden="true" />
            </button>

            {menuOpen && (
              <div className="eve-menu" role="menu">
                {actions.map((action) => (
                  <button
                    key={action.label}
                    type="button"
                    role="menuitem"
                    className={action.danger ? 'eve-menu__item eve-menu__item--danger' : 'eve-menu__item'}
                    onClick={() => {
                      setMenuOpen(false);
                      action.onSelect();
                    }}
                  >
                    {action.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </header>

      <div className="eve-widget__body">{children}</div>

      <footer className="eve-widget__footer">
        <span>
          {now === null
            ? '—'
            : status === 'syncing'
              ? strings.widget.syncing
              : relative
                ? strings.widget.updatedAgo(relative)
                : strings.widget.neverSynced}
        </span>
        <span>{footerExtra ?? (readOnly ? strings.widget.readOnly : null)}</span>
      </footer>
    </section>
  );
}
