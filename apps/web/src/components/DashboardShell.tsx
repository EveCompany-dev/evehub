'use client';

import { addNode, canvasFromGrid, createTextNode, createWidgetNode, type CanvasState } from '@eve/core/canvas';
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
import { visibleRoutes } from '../lib/navigation';
import { Avatar } from '../app/perfil/ProfileForm';
import { CanvasBoard, type CanvasFocusRequest } from './canvas/CanvasBoard';
import { ClientProvider } from './ClientContext';
import { ConnectorSetup } from './ConnectorSetup';
import { CommandPalette, type PaletteCommand } from './CommandPalette';
import { DashboardGrid, type InstanceSummary } from './DashboardGrid';
import { EventStreamProvider } from './EventStreamProvider';
import { SETTINGS_OPTIONS, settingsHref } from './settings-index';
import { useEscapeToClose } from './useEscapeToClose';

const SAVE_DEBOUNCE_MS = 500;

/**
 * First visit to the board with a grid already in place: lay the existing
 * tiles out so the canvas isn't an empty page for someone who had eight
 * widgets a minute ago.
 *
 * Done while seeding state rather than in an effect, so the board never
 * paints empty first. It converts exactly once, because after this the
 * canvas has nodes — and an empty board then stays empty, because the user
 * emptied it.
 */
function seedConfig(config: DashboardConfig): DashboardConfig {
  if (config.mode !== 'canvas' || config.canvas.nodes.length > 0 || config.layout.length === 0) return config;
  return { ...config, canvas: canvasFromGrid(config.layout, config.widgets) };
}

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
   * calculator). Each one placed on the board gets its own instance, because
   * its content *is* the instance — two notes must not share one text.
   * 'external' connectors reuse the instance that already holds the
   * credentials.
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
  const [config, setConfig] = useState<DashboardConfig>(() => seedConfig(initialConfig));
  const [instances, setInstances] = useState<InstanceSummary[]>(initialInstances);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [connectorSetup, setConnectorSetup] = useState<{
    connector: AvailableConnector;
    at: { x: number; y: number } | null;
  } | null>(null);
  const [focusRequest, setFocusRequest] = useState<CanvasFocusRequest | null>(null);
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

  /**
   * The board is saved back whenever it differs from what the server sent —
   * which on a first visit is the grid laid out on the canvas (see
   * `seedConfig`), so that one-time conversion is persisted without a second
   * render pass.
   */
  useEffect(() => {
    if (config !== initialConfig) scheduleSave(config);
    // Only ever compares against the server's own copy: this must not re-run
    // on every later edit, which `update` already persists itself.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const applyTheme = useCallback(
    (theme: DashboardConfig['theme']) => {
      const root = document.documentElement;
      if (theme === 'system') root.removeAttribute('data-theme');
      else root.setAttribute('data-theme', theme);

      update((current) => ({ ...current, theme }));
    },
    [update],
  );

  const setMode = useCallback((mode: DashboardConfig['mode']) => update((current) => ({ ...current, mode })), [update]);

  const toggleLock = useCallback(
    () =>
      update((current) =>
        current.mode === 'canvas'
          ? {
              ...current,
              canvas: { ...current.canvas, locked: !current.canvas.locked },
            }
          : { ...current, locked: !current.locked },
      ),
    [update],
  );

  /**
   * Stable across renders (it closes over nothing but `update`), which is what
   * keeps the board's memoized widget elements alive through a drag.
   */
  const updateCanvas = useCallback(
    (change: (current: CanvasState) => CanvasState) =>
      update((current) => {
        const canvas = change(current.canvas);
        return canvas === current.canvas ? current : { ...current, canvas };
      }),
    [update],
  );

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

  /**
   * Puts a module on the board at `at`.
   *
   * A local widget always gets a fresh instance: its content lives in the
   * instance, so "another notepad" has to mean another notepad. An external
   * connector reuses the instance that already holds its credentials, and two
   * nodes over it are two views of the same data — which is the point of
   * being able to place the same module twice.
   */
  const addModuleToCanvas = useCallback(
    async (connector: AvailableConnector, at: { x: number; y: number }) => {
      if (connector.needsCredentials) {
        setConnectorSetup({ connector, at });
        return;
      }

      const existing =
        connector.category === 'local'
          ? undefined
          : instances.find((instance) => instance.connectorId === connector.id);
      const instance = existing ?? (await createInstance(connector));
      if (!instance) return;

      update((current) => ({
        ...current,
        canvas: addNode(current.canvas, createWidgetNode(instance.id, at, connector.defaultSize)),
      }));
    },
    [createInstance, instances, update],
  );

  /** Grid mode's own "add widget", unchanged: one tile per instance, appended below everything. */
  const addWidgetToGrid = useCallback(
    async (connector: AvailableConnector) => {
      if (connector.needsCredentials) {
        setConnectorSetup({ connector, at: null });
        return;
      }

      const existing = instances.find((instance) => instance.connectorId === connector.id);
      const instance = existing ?? (await createInstance(connector));
      if (!instance) return;

      update((current) => appendWidget(current, instance.id, connector.defaultSize));
    },
    [createInstance, instances, update],
  );

  const addModule = useCallback(
    (connector: AvailableConnector, at?: { x: number; y: number }) => {
      if (config.mode === 'canvas') void addModuleToCanvas(connector, at ?? { x: 80, y: 80 });
      else void addWidgetToGrid(connector);
    },
    [addModuleToCanvas, addWidgetToGrid, config.mode],
  );

  /** The instance already exists by the time the credentials form returns; this only places it. */
  const handleConnected = useCallback(
    (instance: InstanceSummary, connector: AvailableConnector, at: { x: number; y: number } | null) => {
      setInstances((current) => [...current, instance]);
      update((current) =>
        current.mode === 'canvas'
          ? {
              ...current,
              canvas: addNode(
                current.canvas,
                createWidgetNode(instance.id, at ?? { x: 80, y: 80 }, connector.defaultSize),
              ),
            }
          : appendWidget(current, instance.id, connector.defaultSize),
      );
    },
    [update],
  );

  const focusNodes = useCallback((nodeIds: string[]) => {
    setFocusRequest({ nodeIds, token: Date.now() });
  }, []);

  // ---------------------------------------------------------------------
  // Ctrl+K index
  // ---------------------------------------------------------------------

  const commands = useMemo<PaletteCommand[]>(() => {
    const canvasMode = config.mode === 'canvas';
    const instancesById = new Map(instances.map((instance) => [instance.id, instance]));

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
        run: () => addModule(connector),
      }));

    // Telas and the modules actually on the board: picking one flies the
    // viewport to it, which is what makes a tela worth naming.
    const screens = canvasMode
      ? config.canvas.screens.map<PaletteCommand>((screen) => {
          const members = config.canvas.nodes.filter((node) => node.screenId === screen.id);
          return {
            id: `screen:${screen.id}`,
            label: screen.name,
            hint: `${members.length} ${strings.canvas.sectionModules.toLowerCase()}`,
            keywords: ['tela', 'grupo', 'ligacao'],
            section: strings.canvas.sectionScreens,
            run: () => focusNodes(members.map((node) => node.id)),
          };
        })
      : [];

    const boardNodes = canvasMode
      ? config.canvas.nodes.flatMap<PaletteCommand>((node) => {
          if (node.kind === 'widget') {
            const instance = instancesById.get(node.instanceId);
            const screen = config.canvas.screens.find((candidate) => candidate.id === node.screenId);
            return [
              {
                id: `node:${node.id}`,
                label: node.title ?? instance?.label ?? node.instanceId,
                hint: screen?.name,
                section: strings.canvas.sectionModules,
                run: () => focusNodes([node.id]),
              },
            ];
          }
          if (node.kind === 'text' && node.text.trim()) {
            return [
              {
                id: `node:${node.id}`,
                label: node.text.trim().slice(0, 60),
                section: strings.canvas.sectionModules,
                run: () => focusNodes([node.id]),
              },
            ];
          }
          return [];
        })
      : [];

    const actions: PaletteCommand[] = [
      {
        id: 'action:theme',
        label: strings.palette.toggleTheme,
        keywords: ['tema', 'escuro', 'claro', 'dark', 'light'],
        section: strings.palette.sectionActions,
        run: () => applyTheme(config.theme === 'light' ? 'dark' : 'light'),
      },
      {
        id: 'action:mode',
        label: canvasMode ? strings.canvas.modeGrid : strings.canvas.modeCanvas,
        hint: strings.canvas.modeTitle,
        keywords: ['modo', 'canvas', 'grade', 'grid', 'board', 'dashboard'],
        section: strings.palette.sectionActions,
        run: () => setMode(canvasMode ? 'grid' : 'canvas'),
      },
      {
        id: 'action:lock',
        label: (canvasMode ? config.canvas.locked : config.locked) ? strings.dock.unlock : strings.dock.lock,
        keywords: ['travar', 'destravar', 'lock'],
        section: strings.palette.sectionActions,
        run: toggleLock,
      },
      ...(canvasMode
        ? [
            {
              id: 'action:add-text',
              label: strings.canvas.addText,
              keywords: ['texto', 'titulo', 'nota', 'rotulo'],
              section: strings.palette.sectionActions,
              run: () => updateCanvas((current) => addNode(current, createTextNode({ x: 120, y: 120 }))),
            },
            {
              id: 'action:fit',
              label: strings.canvas.fitAll,
              hint: 'Ctrl+1',
              keywords: ['enquadrar', 'zoom', 'ajustar', 'ver tudo'],
              section: strings.palette.sectionActions,
              run: () => focusNodes([]),
            },
          ]
        : []),
      {
        id: 'action:signout',
        label: strings.palette.signOut,
        keywords: ['sair', 'logout', 'deslogar'],
        section: strings.palette.sectionActions,
        run: () => signOut({ callbackUrl: '/login' }),
      },
    ];

    return [...actions, ...navigation, ...screens, ...boardNodes, ...modules, ...settings];
  }, [
    addModule,
    applyTheme,
    available,
    config.canvas.locked,
    config.canvas.nodes,
    config.canvas.screens,
    config.locked,
    config.mode,
    config.theme,
    focusNodes,
    instances,
    router,
    setMode,
    toggleLock,
    updateCanvas,
    visibleTabs,
  ]);

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
        <div className={config.mode === 'canvas' ? 'eve-shell eve-shell--canvas' : 'eve-shell'}>
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

          <main className={config.mode === 'canvas' ? 'eve-main eve-main--canvas' : 'eve-main'}>
            {config.mode === 'canvas' ? (
              <CanvasBoard
                canvas={config.canvas}
                instances={instances}
                available={available}
                onUpdate={updateCanvas}
                onAddModule={(connector, at) => addModule(connector, at)}
                focusRequest={focusRequest}
              />
            ) : (
              <DashboardGrid
                config={config}
                instances={instances}
                onLayoutChange={handleLayoutChange}
                onRemove={handleRemove}
                onViewConfigChange={handleViewConfigChange}
              />
            )}
          </main>
        </div>

        <CommandPalette commands={commands} />

        {connectorSetup && (
          <div className="eve-modal-backdrop" onClick={() => setConnectorSetup(null)}>
            <div className="eve-modal" onClick={(event) => event.stopPropagation()}>
              <ConnectorSetup
                connector={connectorSetup.connector}
                onCancel={() => setConnectorSetup(null)}
                onConnected={(instance) => {
                  const { connector, at } = connectorSetup;
                  setConnectorSetup(null);
                  handleConnected(instance, connector, at);
                }}
              />
            </div>
          </div>
        )}
      </ClientProvider>
    </EventStreamProvider>
  );
}
