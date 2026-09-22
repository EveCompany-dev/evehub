import { z } from 'zod';
import { viewConfigSchema, type ViewConfig } from './widget-view';

/** One tile on the 12-column grid. `i` is the ConnectorInstance id. */
export const widgetLayoutSchema = z.object({
  i: z.string().min(1),
  x: z.number().int().min(0),
  y: z.number().int().min(0),
  w: z.number().int().min(1).max(12),
  h: z.number().int().min(1).max(40),
  /** This one tile only — independent of the board-wide lock toggle. */
  locked: z.boolean().default(false),
});

export const widgetSettingsSchema = z.object({
  /** Overrides the connector's own label for this user only. */
  title: z.string().optional(),
  /**
   * Pins this widget to one client regardless of the global client selector.
   * Empty for now — the selector itself lands in v0.0.4 — but the plumbing
   * exists from day one because retrofitting it across every connector later
   * is the expensive version of this change.
   */
  clientOverride: z.string().nullable().default(null),
  /** null = the widget's own default view (today: a plain table). */
  viewConfig: viewConfigSchema.nullable().default(null),
});

/**
 * The dashboard at `/` is the 12-column grid, and only the grid. A freeform
 * "canvas" mode existed as an opt-in alternative until 2026-09-22; configs
 * saved back then still carry `mode`/`canvas` (and a `density` setting),
 * which this schema drops on parse — see parseDashboardConfig for how the
 * widgets someone had on the canvas are kept.
 */
export const dashboardConfigSchema = z.object({
  layout: z.array(widgetLayoutSchema).default([]),
  widgets: z.record(z.string(), widgetSettingsSchema).default({}),
  theme: z.enum(['dark', 'light', 'system']).default('system'),
  activeClient: z.string().nullable().default(null),
  /** Trava arrastar/redimensionar, para nao desmontar o layout sem querer. */
  locked: z.boolean().default(false),
  /** URL da imagem de fundo da dashboard. null = sem imagem. */
  backgroundImage: z.string().nullable().default(null),
  /** Cor solida atras/por baixo da imagem (ou sozinha, sem imagem). */
  backgroundColor: z.string().nullable().default(null),
  /**
   * false = widgets so atualizam por sync manual, ignorando o evento SSE de
   * "dado mudou". Util em conexoes fracas ou pra quem acha o auto-refresh
   * distraente; sync manual e o botao "sincronizar agora" continuam ativos.
   */
  liveUpdates: z.boolean().default(true),
  /**
   * Escala geral da interface (zoom) — removida do Settings por enquanto
   * (causava a maioria dos bugs de drag/posicionamento/tamanho do app: drift
   * no dnd-kit, no menu de contexto, no react-grid-layout, overflow de
   * `dvh`, hit-testing quebrado no drag-and-drop nativo). O campo continua
   * aqui so para nao invalidar configs ja salvas; layout.tsx ignora o valor e
   * fixa `zoom: 1` sempre.
   */
  uiScale: z.number().min(0.5).max(2).default(1),
  /**
   * Quando true, a seta da barra lateral esconde a barra inteira em vez de
   * so alternar entre icone e icone+texto.
   */
  railFullHide: z.boolean().default(false),
  /**
   * false = so o cursor nativo do sistema, sem a bolinha laranja que o
   * segue. A decoracao e puro enfeite; quem acha o rastro distraente (ou
   * usa a interface o dia inteiro) desliga aqui.
   */
  cursorFollower: z.boolean().default(true),
  /**
   * Pagina em que o app abre para este usuario (um href de lib/navigation.ts,
   * ex.: "/clients/calendar"). null = o dashboard. Validado contra o que o
   * usuario pode ver na hora de redirecionar, nao aqui.
   */
  defaultPage: z.string().max(200).nullable().default(null),
});

export type WidgetLayout = z.infer<typeof widgetLayoutSchema>;
export { viewConfigSchema } from './widget-view';
export type { ViewConfig } from './widget-view';
export type WidgetSettings = z.infer<typeof widgetSettingsSchema>;
export type DashboardConfig = z.infer<typeof dashboardConfigSchema>;

export const emptyDashboardConfig: DashboardConfig = {
  layout: [],
  widgets: {},
  theme: 'system',
  activeClient: null,
  locked: false,
  backgroundImage: null,
  backgroundColor: null,
  liveUpdates: true,
  uiScale: 1,
  railFullHide: false,
  cursorFollower: true,
  defaultPage: null,
};

/**
 * Never throws. A user whose stored config predates a schema change gets the
 * default layout back instead of a broken dashboard.
 */
export function parseDashboardConfig(value: unknown): DashboardConfig {
  const parsed = dashboardConfigSchema.safeParse(value ?? {});
  if (!parsed.success) return { ...emptyDashboardConfig };
  return carryOverCanvasWidgets(value, parsed.data);
}

/**
 * Someone who was on the (removed) canvas mode would otherwise open the grid
 * and find only whatever it held before they switched — or nothing. Every
 * module that was on their canvas and isn't on the grid yet is appended to it
 * instead. Runs only while the stored config still says `mode: 'canvas'`; the
 * first save writes the config back without it, so this happens once.
 */
function carryOverCanvasWidgets(raw: unknown, config: DashboardConfig): DashboardConfig {
  if (!raw || typeof raw !== 'object') return config;
  const legacy = raw as { mode?: unknown; canvas?: { nodes?: unknown } };
  if (legacy.mode !== 'canvas' || !Array.isArray(legacy.canvas?.nodes)) return config;

  let next = config;
  for (const node of legacy.canvas.nodes) {
    if (!node || typeof node !== 'object') continue;
    const { kind, instanceId } = node as { kind?: unknown; instanceId?: unknown };
    if (kind !== 'widget' || typeof instanceId !== 'string' || !instanceId) continue;
    next = appendWidget(next, instanceId);
    // The canvas read the same per-instance settings (title, chosen view);
    // appendWidget would reset them.
    const saved = config.widgets[instanceId];
    if (saved) next = { ...next, widgets: { ...next.widgets, [instanceId]: saved } };
  }
  return next;
}

const GRID_COLS = 12;

/**
 * First gap the new tile fits in, scanning row-major (top row first, then
 * left to right within it) — so a new widget lands beside whatever's already
 * on the last row it has room next to, rather than always starting a new row
 * underneath everything. Only when no existing row has `w` free columns does
 * it fall through to the row past everything (the old always-stack-below
 * behavior), which the loop reaches naturally since that row is empty.
 */
function findFreeSpot(layout: WidgetLayout[], w: number, h: number): { x: number; y: number } {
  const overlaps = (x: number, y: number) =>
    layout.some((item) => x < item.x + item.w && x + w > item.x && y < item.y + item.h && y + h > item.y);

  const maxY = layout.reduce((max, item) => Math.max(max, item.y + item.h), 0);
  for (let y = 0; y <= maxY; y += 1) {
    for (let x = 0; x <= GRID_COLS - w; x += 1) {
      if (!overlaps(x, y)) return { x, y };
    }
  }
  return { x: 0, y: maxY };
}

/** Places a new widget in the first free gap — beside existing widgets when there's room, below them otherwise. */
export function appendWidget(
  config: DashboardConfig,
  instanceId: string,
  size: { w: number; h: number } = { w: 6, h: 6 },
): DashboardConfig {
  if (config.layout.some((item) => item.i === instanceId)) return config;

  const { x, y } = findFreeSpot(config.layout, size.w, size.h);
  return {
    ...config,
    layout: [...config.layout, { i: instanceId, x, y, w: size.w, h: size.h, locked: false }],
    widgets: { ...config.widgets, [instanceId]: { clientOverride: null, viewConfig: null } },
  };
}

export function removeWidget(config: DashboardConfig, instanceId: string): DashboardConfig {
  const widgets = { ...config.widgets };
  delete widgets[instanceId];
  return { ...config, layout: config.layout.filter((item) => item.i !== instanceId), widgets };
}

/** Toggles one tile's own lock — independent of the board-wide lock toggle. */
export function toggleWidgetLock(config: DashboardConfig, instanceId: string): DashboardConfig {
  return {
    ...config,
    layout: config.layout.map((item) => (item.i === instanceId ? { ...item, locked: !item.locked } : item)),
  };
}

/** Updates one widget's view (which fields show, table vs. stat-cards), leaving everything else untouched. */
export function setViewConfig(config: DashboardConfig, instanceId: string, viewConfig: ViewConfig): DashboardConfig {
  const existing = config.widgets[instanceId] ?? { clientOverride: null, viewConfig: null };
  return { ...config, widgets: { ...config.widgets, [instanceId]: { ...existing, viewConfig } } };
}

export type GeneralSettings = Pick<
  DashboardConfig,
  | 'backgroundImage'
  | 'backgroundColor'
  | 'liveUpdates'
  | 'uiScale'
  | 'railFullHide'
  | 'cursorFollower'
  | 'defaultPage'
>;

/** Merges dashboard-wide appearance/behavior settings (the gear panel), leaving layout/widgets untouched. */
export function updateGeneralSettings(config: DashboardConfig, patch: Partial<GeneralSettings>): DashboardConfig {
  return { ...config, ...patch };
}
