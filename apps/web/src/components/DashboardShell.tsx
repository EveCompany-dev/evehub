'use client';

import {
  appendWidget,
  removeWidget,
  setViewConfig,
  type DashboardConfig,
  type ViewConfig,
  type WidgetLayout,
} from '@eve/core/dashboard';
import { EveBrandLockup, strings } from '@eve/ui';
import { useRouter } from 'next/navigation';
import { signOut } from 'next-auth/react';
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type JSX } from 'react';
import { Avatar } from '../app/perfil/ProfileForm';
import { ClientProvider } from './ClientContext';
import { ConnectorSetup } from './ConnectorSetup';
import { CommandPalette, type PaletteCommand } from './CommandPalette';
import { DashboardGrid, type InstanceSummary } from './DashboardGrid';
import { EventStreamProvider } from './EventStreamProvider';
import { useEscapeToClose } from './useEscapeToClose';

const SAVE_DEBOUNCE_MS = 500;

export interface AvailableConnector {
  id: string;
  label: string;
  description: string | null;
  defaultSize: { w: number; h: number };
  canCreate: boolean;
  /** Exige segredo, entao passa pelo formulario de conexao antes de existir. */
  needsCredentials: boolean;
}

export interface DashboardShellProps {
  userName: string;
  userEmail: string;
  userImage: string | null;
  isOwner: boolean;
  initialConfig: DashboardConfig;
  initialInstances: InstanceSummary[];
  available: AvailableConnector[];
}

export function DashboardShell({
  userName,
  userEmail,
  userImage,
  isOwner,
  initialConfig,
  initialInstances,
  available,
}: DashboardShellProps): JSX.Element {
  const router = useRouter();
  const [config, setConfig] = useState<DashboardConfig>(initialConfig);
  const [instances, setInstances] = useState<InstanceSummary[]>(initialInstances);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [connectorSetup, setConnectorSetup] = useState<AvailableConnector | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEscapeToClose(() => setConnectorSetup(null));

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

  const toggleLock = useCallback(() => {
    setConfig((current) => {
      const next = { ...current, locked: !current.locked };
      scheduleSave(next);
      return next;
    });
  }, [scheduleSave]);

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

  const handleViewConfigChange = useCallback(
    (instanceId: string, viewConfig: ViewConfig) => {
      setConfig((current) => {
        const next = setViewConfig(current, instanceId, viewConfig);
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

  /** A instancia ja foi criada pelo formulario; aqui so entra no layout. */
  const handleConnected = useCallback(
    (instance: InstanceSummary, connector: AvailableConnector) => {
      setInstances((current) => [...current, instance]);
      setConfig((current) => {
        const next = appendWidget(current, instance.id, connector.defaultSize);
        scheduleSave(next);
        return next;
      });
    },
    [scheduleSave],
  );

  const commands = useMemo<PaletteCommand[]>(() => {
    const widgetCommands = available
      .filter((connector) => connector.canCreate)
      .map<PaletteCommand>((connector) => ({
        id: `add:${connector.id}`,
        label: connector.label,
        hint: connector.description ?? undefined,
        section: strings.palette.sectionWidgets,
        // A credentialed connector (e.g. Notion) needs a form for its token
        // before an instance can exist — everything else adds straight away.
        run: () => (connector.needsCredentials ? setConnectorSetup(connector) : addWidget(connector)),
      }));

    return [
      {
        id: 'theme',
        label: strings.palette.toggleTheme,
        section: strings.palette.sectionActions,
        run: () => applyTheme(config.theme === 'light' ? 'dark' : 'light'),
      },
      {
        id: 'lock',
        label: config.locked ? strings.dock.unlock : strings.dock.lock,
        section: strings.palette.sectionActions,
        run: toggleLock,
      },
      {
        id: 'signout',
        label: strings.palette.signOut,
        section: strings.palette.sectionActions,
        run: () => signOut({ callbackUrl: '/login' }),
      },
      ...widgetCommands,
    ];
  }, [addWidget, applyTheme, available, config.locked, config.theme, toggleLock]);

  // A dedicated fixed layer behind everything, rather than styling <main>
  // itself: <main> sits inside the normal content flow, so its own background
  // paint only ever shows through the gutters between widgets (or not at all
  // if the grid's content box doesn't stretch to fill it) and never actually
  // covers the viewport the way a page background is expected to. A
  // position:fixed layer at z-index:-1 has none of that ambiguity — it's
  // simply behind every other element, full stop.
  const backgroundStyle: CSSProperties = {
    ...(config.backgroundColor ? { backgroundColor: config.backgroundColor } : {}),
    ...(config.backgroundImage ? { backgroundImage: `url(${config.backgroundImage})` } : {}),
  };
  const hasCustomBackground = Boolean(config.backgroundImage || config.backgroundColor);

  return (
    <EventStreamProvider liveUpdates={config.liveUpdates}>
      <ClientProvider initialClient={config.activeClient}>
        {hasCustomBackground && <div className="eve-page-background" style={backgroundStyle} aria-hidden="true" />}

        <header className="eve-header">
          <div className="eve-header__brand">
            <EveBrandLockup suffix=".company" />
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
            <button
              type="button"
              className="eve-profile-btn"
              title={`${userName} — ${strings.profile.title}`}
              aria-label={strings.profile.title}
              onClick={() => router.push('/perfil')}
            >
              <Avatar name={userName} email={userEmail} image={userImage} size={34} />
            </button>
          </div>
        </header>

        <main className="eve-main">
          <DashboardGrid
            config={config}
            instances={instances}
            onLayoutChange={handleLayoutChange}
            onRemove={handleRemove}
            onViewConfigChange={handleViewConfigChange}
          />
        </main>

        <CommandPalette commands={commands} />

        {connectorSetup && (
          <div className="eve-modal-backdrop" onClick={() => setConnectorSetup(null)}>
            <div className="eve-modal" onClick={(event) => event.stopPropagation()}>
              <ConnectorSetup
                connector={connectorSetup}
                onCancel={() => setConnectorSetup(null)}
                onConnected={(instance) => {
                  const connector = connectorSetup;
                  setConnectorSetup(null);
                  handleConnected(instance, connector);
                }}
              />
            </div>
          </div>
        )}
      </ClientProvider>
    </EventStreamProvider>
  );
}
