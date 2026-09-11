'use client';

import { appendWidget, removeWidget, type DashboardConfig, type WidgetLayout } from '@eve/core/dashboard';
import { strings } from '@eve/ui';
import { signOut } from 'next-auth/react';
import { useCallback, useEffect, useMemo, useRef, useState, type JSX } from 'react';
import { ClientProvider } from './ClientContext';
import { CommandPalette, type PaletteCommand } from './CommandPalette';
import { DashboardGrid, type InstanceSummary } from './DashboardGrid';
import { EventStreamProvider } from './EventStreamProvider';

const SAVE_DEBOUNCE_MS = 500;

export interface AvailableConnector {
  id: string;
  label: string;
  description: string | null;
  defaultSize: { w: number; h: number };
  canCreate: boolean;
}

export interface DashboardShellProps {
  userName: string;
  isOwner: boolean;
  initialConfig: DashboardConfig;
  initialInstances: InstanceSummary[];
  available: AvailableConnector[];
}

export function DashboardShell({
  userName,
  isOwner,
  initialConfig,
  initialInstances,
  available,
}: DashboardShellProps): JSX.Element {
  const [config, setConfig] = useState<DashboardConfig>(initialConfig);
  const [instances, setInstances] = useState<InstanceSummary[]>(initialInstances);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const persist = useCallback(async (next: DashboardConfig) => {
    const response = await fetch('/api/dashboard-config', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(next),
    });
    if (response.ok) setSavedAt(Date.now());
  }, []);

  /** Drag/resize fires continuously; only the settled layout reaches the API. */
  const scheduleSave = useCallback(
    (next: DashboardConfig) => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => void persist(next), SAVE_DEBOUNCE_MS);
    },
    [persist],
  );

  useEffect(() => () => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
  }, []);

  const applyTheme = useCallback(
    (theme: DashboardConfig['theme']) => {
      const root = document.documentElement;
      if (theme === 'system') root.removeAttribute('data-theme');
      else root.setAttribute('data-theme', theme);

      const next = { ...config, theme };
      setConfig(next);
      void persist(next);
    },
    [config, persist],
  );

  const handleLayoutChange = useCallback(
    (layout: WidgetLayout[]) => {
      setConfig((current) => {
        // Ignore the echo when nothing actually moved, otherwise every mount
        // would write to the database.
        if (JSON.stringify(current.layout) === JSON.stringify(layout)) return current;
        const next = { ...current, layout };
        scheduleSave(next);
        return next;
      });
    },
    [scheduleSave],
  );

  const handleRemove = useCallback(
    (instanceId: string) => {
      setConfig((current) => {
        // Removes the widget from this user's dashboard only. The connector
        // instance and its history stay — deleting those is an owner action.
        const next = removeWidget(current, instanceId);
        scheduleSave(next);
        return next;
      });
    },
    [scheduleSave],
  );

  const addWidget = useCallback(
    async (connector: AvailableConnector) => {
      const existing = instances.find((instance) => instance.connectorId === connector.id);

      let instance = existing;
      if (!instance) {
        const response = await fetch('/api/instances', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ connectorId: connector.id, label: connector.label }),
        });
        if (!response.ok) return;

        const body = (await response.json()) as { instance: InstanceSummary };
        instance = body.instance;
        setInstances((current) => [...current, body.instance]);
      }

      setConfig((current) => {
        const next = appendWidget(current, instance.id, connector.defaultSize);
        scheduleSave(next);
        return next;
      });
    },
    [instances, scheduleSave],
  );

  const commands = useMemo<PaletteCommand[]>(() => {
    const widgetCommands = available
      .filter((connector) => connector.canCreate)
      .map<PaletteCommand>((connector) => ({
        id: `add:${connector.id}`,
        label: connector.label,
        hint: connector.description ?? undefined,
        section: strings.palette.sectionWidgets,
        run: () => addWidget(connector),
      }));

    return [
      {
        id: 'theme',
        label: strings.palette.toggleTheme,
        section: strings.palette.sectionActions,
        run: () => applyTheme(config.theme === 'light' ? 'dark' : 'light'),
      },
      {
        id: 'signout',
        label: strings.palette.signOut,
        section: strings.palette.sectionActions,
        run: () => signOut({ callbackUrl: '/login' }),
      },
      ...widgetCommands,
    ];
  }, [addWidget, applyTheme, available, config.theme]);

  return (
    <EventStreamProvider>
      <ClientProvider initialClient={config.activeClient}>
        <header className="eve-header">
          <div className="eve-header__brand">
            <span className="eve-header__mark">EVE</span>
            <span className="eve-dim">{strings.app.tagline}</span>
          </div>

          <div className="eve-header__actions">
            {savedAt && <span className="eve-dim">{strings.dashboard.layoutSaved}</span>}
            <kbd className="eve-kbd">Ctrl K</kbd>
            <button
              type="button"
              className="eve-btn"
              onClick={() => applyTheme(config.theme === 'light' ? 'dark' : 'light')}
            >
              {config.theme === 'light' ? 'escuro' : 'claro'}
            </button>
            <span className="eve-dim">
              {userName}
              {isOwner ? ' · owner' : ''}
            </span>
            <button type="button" className="eve-btn" onClick={() => void signOut({ callbackUrl: '/login' })}>
              {strings.auth.signOut}
            </button>
          </div>
        </header>

        <main className="eve-main">
          <DashboardGrid
            config={config}
            instances={instances}
            onLayoutChange={handleLayoutChange}
            onRemove={handleRemove}
          />
        </main>

        <CommandPalette commands={commands} />
      </ClientProvider>
    </EventStreamProvider>
  );
}
