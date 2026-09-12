'use client';

import type { GeneralSettings } from '@eve/core/dashboard';
import { strings } from '@eve/ui';
import { useEffect, useMemo, useRef, useState, type JSX } from 'react';
import { ConnectorSetup } from './ConnectorSetup';
import { DashboardSettingsPanel } from './DashboardSettingsPanel';
import type { AvailableConnector } from './DashboardShell';

export interface DashboardDockProps {
  available: AvailableConnector[];
  locked: boolean;
  onToggleLock: () => void;
  onAdd: (connector: AvailableConnector) => void | Promise<void>;
  /** Chamado quando o formulario de credencial ja criou a instancia. */
  onConnected: (instance: { id: string; connectorId: string; label: string }, connector: AvailableConnector) => void;
  settings: GeneralSettings;
  onSettingsChange: (patch: Partial<GeneralSettings>) => void;
}

type Panel = 'add' | 'settings' | null;

/**
 * Pill flutuante sobre a dashboard.
 *
 * Fica fora do grid de proposito: e o unico controle que precisa estar sempre
 * alcancavel, inclusive com a tela cheia de widgets. O `+` abre o catalogo de
 * modulos; o cadeado congela o layout inteiro.
 */
export function DashboardDock({
  available,
  locked,
  onToggleLock,
  onAdd,
  onConnected,
  settings,
  onSettingsChange,
}: DashboardDockProps): JSX.Element {
  const [panel, setPanel] = useState<Panel>(null);
  const [query, setQuery] = useState('');
  // Connector escolhido que ainda precisa de credencial.
  const [setup, setSetup] = useState<AvailableConnector | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!panel) return;

    if (panel === 'add' && !setup) inputRef.current?.focus();

    const onPointerDown = (event: MouseEvent) => {
      if (!panelRef.current?.contains(event.target as Node)) setPanel(null);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setPanel(null);
        setSetup(null);
      }
    };

    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [panel, setup]);

  const results = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) return available;
    return available.filter((connector) =>
      `${connector.label} ${connector.description ?? ''}`.toLowerCase().includes(term),
    );
  }, [available, query]);

  return (
    <div className="eve-dock" ref={panelRef}>
      {panel === 'add' && (
        <div className="eve-dock__panel" role="dialog" aria-label={strings.dock.addTitle}>
          {setup ? (
            <ConnectorSetup
              connector={setup}
              onCancel={() => setSetup(null)}
              onConnected={(instance) => {
                const connector = setup;
                setSetup(null);
                setPanel(null);
                setQuery('');
                onConnected(instance, connector);
              }}
            />
          ) : (
          <>
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
                title={connector.canCreate ? undefined : strings.dock.ownerOnly}
                onClick={() => {
                  // Precisa de segredo: abre o formulario em vez de criar
                  // uma instancia que nasceria quebrada.
                  if (connector.needsCredentials) {
                    setSetup(connector);
                    return;
                  }
                  setPanel(null);
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
          </>
          )}
        </div>
      )}

      {panel === 'settings' && (
        <div className="eve-dock__panel" role="dialog" aria-label={strings.dock.settingsTitle}>
          <DashboardSettingsPanel settings={settings} onChange={onSettingsChange} />
        </div>
      )}

      <div className="eve-dock__pill">
        <button
          type="button"
          className="eve-dock__btn eve-dock__btn--add"
          aria-expanded={panel === 'add'}
          aria-label={strings.dock.addTitle}
          title={strings.dock.addTitle}
          onClick={() => setPanel((value) => (value === 'add' ? null : 'add'))}
        >
          <span className={panel === 'add' ? 'eve-dock__plus is-open' : 'eve-dock__plus'}>+</span>
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

        <span className="eve-dock__divider" aria-hidden="true" />

        <button
          type="button"
          className={panel === 'settings' ? 'eve-dock__btn is-active' : 'eve-dock__btn'}
          aria-expanded={panel === 'settings'}
          aria-label={strings.dock.settingsTitle}
          title={strings.dock.settingsTitle}
          onClick={() => setPanel((value) => (value === 'settings' ? null : 'settings'))}
        >
          {/* Engrenagem. */}
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="2" />
            <path
              d="M19.4 13a7.97 7.97 0 0 0 0-2l2.03-1.58a.5.5 0 0 0 .12-.64l-1.92-3.32a.5.5 0 0 0-.6-.22l-2.39.96a7.9 7.9 0 0 0-1.73-1l-.36-2.54a.5.5 0 0 0-.5-.43h-3.84a.5.5 0 0 0-.5.43l-.36 2.54a7.9 7.9 0 0 0-1.73 1l-2.39-.96a.5.5 0 0 0-.6.22L2.7 8.78a.5.5 0 0 0 .12.64L4.85 11a7.97 7.97 0 0 0 0 2l-2.03 1.58a.5.5 0 0 0-.12.64l1.92 3.32a.5.5 0 0 0 .6.22l2.39-.96a7.9 7.9 0 0 0 1.73 1l.36 2.54a.5.5 0 0 0 .5.43h3.84a.5.5 0 0 0 .5-.43l.36-2.54a7.9 7.9 0 0 0 1.73-1l2.39.96a.5.5 0 0 0 .6-.22l1.92-3.32a.5.5 0 0 0-.12-.64L19.4 13Z"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      </div>
    </div>
  );
}
