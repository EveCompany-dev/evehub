'use client';

import {
  appendWidget,
  removeWidget,
  setViewConfig,
  toggleWidgetLock,
  type DashboardConfig,
  type ViewConfig,
  type WidgetLayout,
} from '@eve/core/dashboard';
import { EveBrandLockup, strings } from '@eve/ui';
import { useRouter } from 'next/navigation';
import { signOut } from 'next-auth/react';
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type JSX } from 'react';
import { visibleRoutes } from '../lib/navigation';
import { Avatar } from '../app/perfil/ProfileForm';
import { ClientProvider } from './ClientContext';
import { ConnectorSetup } from './ConnectorSetup';
import { CommandPalette, type PaletteCommand } from './CommandPalette';
import { DashboardGrid, type InstanceSummary } from './DashboardGrid';
import { EventStreamProvider } from './EventStreamProvider';
import { SETTINGS_OPTIONS, settingsHref } from './settings-index';
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
  /**
   * 'local' = self-contained widget with nothing to connect (notes,
   * calculator); 'external' = backed by a real integration and its
   * credentials. The grid reuses an existing instance either way.
   */
  category: 'external' | 'local';
}

export interface DashboardShellProps {
  userName: string;
  userEmail: string;
  userImage: string | null;
  isOwner: boolean;
  initialConfig: DashboardConfig;
  initialInstances: InstanceSummary[];
  available: AvailableConnector[];
  /** From getVisibleTabs(), so the palette only offers pages this user can open. */
  visibleTabs: string[];
}

export function DashboardShell({
  userName,
  userEmail,
  userImage,
  isOwner,
  initialConfig,
  initialInstances,
  available,
  visibleTabs,
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

  /** Drag/resize/pan fire continuously; only the settled state reaches the API. */
  const scheduleSave = useCallback(
    (next: DashboardConfig) => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => void persist(next), SAVE_DEBOUNCE_MS);
    },
    [persist],
  );

  useEffect(
    () => () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    },
    [],
  );

  /** The one way anything in here changes the stored config. */
  const update = useCallback(
    (change: (current: DashboardConfig) => DashboardConfig) => {
      setConfig((current) => {
        const next = change(current);
        if (next === current) return current;
        scheduleSave(next);
        return next;
      });
    },
    [scheduleSave],
  );

  const applyTheme = useCallback(
    (theme: DashboardConfig['theme']) => {
      const root = document.documentElement;
      if (theme === 'system') root.removeAttribute('data-theme');
      else root.setAttribute('data-theme', theme);

      update((current) => ({ ...current, theme }));
    },
    [update],
  );

  const toggleLock = useCallback(() => update((current) => ({ ...current, locked: !current.locked })), [update]);

  const handleLayoutChange = useCallback(
    (layout: WidgetLayout[]) => {
      update((current) => {
        // Ignore the echo when nothing actually moved, otherwise every mount
        // would write to the database.
        if (JSON.stringify(current.layout) === JSON.stringify(layout)) return current;
        return { ...current, layout };
      });
    },
    [update],
  );

  const handleRemove = useCallback(
    // Removes the widget from this user's grid only. The connector instance
    // and its history stay — deleting those is an owner action.
    (instanceId: string) => update((current) => removeWidget(current, instanceId)),
    [update],
  );

  const handleToggleWidgetLock = useCallback(
    (instanceId: string) => update((current) => toggleWidgetLock(current, instanceId)),
    [update],
  );

  const handleViewConfigChange = useCallback(
    (instanceId: string, viewConfig: ViewConfig) => update((current) => setViewConfig(current, instanceId, viewConfig)),
    [update],
  );

  const createInstance = useCallback(async (connector: AvailableConnector): Promise<InstanceSummary | null> => {
    const response = await fetch('/api/instances', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        connectorId: connector.id,
        label: connector.label,
      }),
    });
    if (!response.ok) return null;

    const body = (await response.json()) as { instance: InstanceSummary };
    setInstances((current) => [...current, body.instance]);
    return body.instance;
  }, []);

  /** One tile per instance, placed in the first free gap. */
  const addModule = useCallback(
    async (connector: AvailableConnector) => {
      if (connector.needsCredentials) {
        setConnectorSetup(connector);
        return;
      }

      const existing = instances.find((instance) => instance.connectorId === connector.id);
      const instance = existing ?? (await createInstance(connector));
      if (!instance) return;

      update((current) => appendWidget(current, instance.id, connector.defaultSize));
    },
    [createInstance, instances, update],
  );

  /** The instance already exists by the time the credentials form returns; this only places it. */
  const handleConnected = useCallback(
    (instance: InstanceSummary, connector: AvailableConnector) => {
      setInstances((current) => [...current, instance]);
      update((current) => appendWidget(current, instance.id, connector.defaultSize));
    },
    [update],
  );

  // ---------------------------------------------------------------------
  // Ctrl+K index
  // ---------------------------------------------------------------------

  const commands = useMemo<PaletteCommand[]>(() => {
    const navigation = visibleRoutes(visibleTabs).map<PaletteCommand>((route) => ({
      id: `nav:${route.href}`,
      label: route.label,
      hint: route.href,
      keywords: route.keywords,
      section: strings.palette.sectionNavigate,
      run: () => router.push(route.href),
    }));

    const settings = SETTINGS_OPTIONS.map<PaletteCommand>((option) => ({
      id: `setting:${option.id}`,
      label: option.label,
      hint: strings.dashboardSettings.title,
      keywords: option.keywords,
      section: strings.palette.sectionSettings,
      run: () => router.push(settingsHref(option)),
    }));

    const modules = available
      .filter((connector) => connector.canCreate)
      .map<PaletteCommand>((connector) => ({
        id: `add:${connector.id}`,
        label: connector.label,
        hint: connector.description ?? undefined,
        section: strings.palette.sectionWidgets,
        run: () => void addModule(connector),
      }));

    const actions: PaletteCommand[] = [
      {
        id: 'action:theme',
        label: strings.palette.toggleTheme,
        keywords: ['tema', 'escuro', 'claro', 'dark', 'light'],
        section: strings.palette.sectionActions,
        run: () => applyTheme(config.theme === 'light' ? 'dark' : 'light'),
      },
      {
        id: 'action:lock',
        label: config.locked ? strings.dock.unlock : strings.dock.lock,
        keywords: ['travar', 'destravar', 'lock'],
        section: strings.palette.sectionActions,
        run: toggleLock,
      },
      {
        id: 'action:signout',
        label: strings.palette.signOut,
        keywords: ['sair', 'logout', 'deslogar'],
        section: strings.palette.sectionActions,
        run: () => signOut({ callbackUrl: '/login' }),
      },
    ];

    return [...actions, ...navigation, ...modules, ...settings];
  }, [addModule, applyTheme, available, config.locked, config.theme, router, toggleLock, visibleTabs]);

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

        {/* The board needs the viewport minus the header, and the header's
            height comes from its own content. A flex column here settles that
            without anyone hard-coding a number. */}
        <div className="eve-shell">
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
              available={available}
              onLayoutChange={handleLayoutChange}
              onRemove={handleRemove}
              onViewConfigChange={handleViewConfigChange}
              onAddModule={(connector) => void addModule(connector)}
              onToggleWidgetLock={handleToggleWidgetLock}
            />
          </main>
        </div>

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
