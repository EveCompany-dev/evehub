'use client';

import { strings } from '@eve/ui';
import { useEffect, useMemo, useRef, useState, type JSX } from 'react';
import type { AvailableConnector } from './DashboardShell';

export interface DashboardDockProps {
  available: AvailableConnector[];
  locked: boolean;
  onToggleLock: () => void;
  onAdd: (connector: AvailableConnector) => void | Promise<void>;
}

/**
 * Pill flutuante sobre a dashboard.
 *
 * Fica fora do grid de proposito: e o unico controle que precisa estar sempre
 * alcancavel, inclusive com a tela cheia de widgets. O `+` abre o catalogo de
 * modulos; o cadeado congela o layout inteiro.
 */
export function DashboardDock({ available, locked, onToggleLock, onAdd }: DashboardDockProps): JSX.Element {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const panelRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;

    inputRef.current?.focus();

    const onPointerDown = (event: MouseEvent) => {
      if (!panelRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };

    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const results = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) return available;
    return available.filter((connector) =>
      `${connector.label} ${connector.description ?? ''}`.toLowerCase().includes(term),
    );
  }, [available, query]);

  return (
    <div className="eve-dock" ref={panelRef}>
      {open && (
        <div className="eve-dock__panel" role="dialog" aria-label={strings.dock.addTitle}>
          <input
            ref={inputRef}
            className="eve-dock__search"
            placeholder={strings.dock.searchPlaceholder}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />

          <div className="eve-dock__list">
            {results.length === 0 && <p className="eve-dock__empty">{strings.dock.noResults}</p>}

            {results.map((connector) => (
              <button
                key={connector.id}
                type="button"
                className="eve-dock__item"
                disabled={!connector.canCreate}
                title={connector.canCreate ? undefined : strings.errors.notOwner}
                onClick={() => {
                  setOpen(false);
                  setQuery('');
                  void onAdd(connector);
                }}
              >
                <span className="eve-dock__item-label">{connector.label}</span>
                {connector.description && <span className="eve-dock__item-desc">{connector.description}</span>}
              </button>
            ))}
          </div>

          <p className="eve-dock__hint">{strings.dock.catalogHint}</p>
        </div>
      )}

      <div className="eve-dock__pill">
        <button
          type="button"
          className="eve-dock__btn eve-dock__btn--add"
          aria-expanded={open}
          aria-label={strings.dock.addTitle}
          title={strings.dock.addTitle}
          onClick={() => setOpen((value) => !value)}
        >
          <span className={open ? 'eve-dock__plus is-open' : 'eve-dock__plus'}>+</span>
        </button>

        <span className="eve-dock__divider" aria-hidden="true" />

        <button
          type="button"
          className={locked ? 'eve-dock__btn is-active' : 'eve-dock__btn'}
          aria-pressed={locked}
          aria-label={locked ? strings.dock.unlock : strings.dock.lock}
          title={locked ? strings.dock.unlock : strings.dock.lock}
          onClick={onToggleLock}
        >
          {/* Cadeado: o arco muda de fechado para aberto. */}
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <rect x="4" y="10.5" width="16" height="10" rx="2.5" fill="currentColor" />
            <path
              d={locked ? 'M8 10.5V7a4 4 0 0 1 8 0v3.5' : 'M8 10.5V7a4 4 0 0 1 8 0'}
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              fill="none"
            />
          </svg>
        </button>
      </div>
    </div>
  );
}
