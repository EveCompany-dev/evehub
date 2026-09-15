import { z } from 'zod';

/** One tile on the 12-column grid. `i` is the ConnectorInstance id. */
export const widgetLayoutSchema = z.object({
  i: z.string().min(1),
  x: z.number().int().min(0),
  y: z.number().int().min(0),
  w: z.number().int().min(1).max(12),
  h: z.number().int().min(1).max(40),
});

/**
 * How a widget's synced data renders, chosen by the user from the widget's
 * own menu — not by editing any widget component. `fields: null` means "show
 * every field the connector/auto-detection reports" (up to the view's own
 * cap); an explicit array is both the subset AND the display order.
 */
export const viewConfigSchema = z.object({
  kind: z.enum(['table', 'stat-cards']).default('table'),
  fields: z.array(z.string()).nullable().default(null),
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
  /** Altura de linha/margem do grid: 'compact' cabe mais widget na tela. */
  density: z.enum(['comfortable', 'compact']).default('comfortable'),
  /**
   * false = widgets so atualizam por sync manual, ignorando o evento SSE de
   * "dado mudou". Util em conexoes fracas ou pra quem acha o auto-refresh
   * distraente; sync manual e o botao "sincronizar agora" continuam ativos.
   */
  liveUpdates: z.boolean().default(true),
  /**
   * Escala geral da interface (zoom). Padrao 1.5 (150%) — a interface na
   * densidade original ficou pequena demais em monitores comuns de notebook.
   */
  uiScale: z.number().min(0.5).max(2).default(1.5),
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
});

export type WidgetLayout = z.infer<typeof widgetLayoutSchema>;
export type ViewConfig = z.infer<typeof viewConfigSchema>;
export type WidgetSettings = z.infer<typeof widgetSettingsSchema>;
export type DashboardConfig = z.infer<typeof dashboardConfigSchema>;
export type DashboardDensity = DashboardConfig['density'];

export const emptyDashboardConfig: DashboardConfig = {
  layout: [],
  widgets: {},
  theme: 'system',
  activeClient: null,
  locked: false,
  backgroundImage: null,
  backgroundColor: null,
  density: 'comfortable',
  liveUpdates: true,
  uiScale: 1.5,
  railFullHide: false,
  cursorFollower: true,
};

/**
 * Never throws. A user whose stored config predates a schema change gets the
 * default layout back instead of a broken dashboard.
 */
export function parseDashboardConfig(value: unknown): DashboardConfig {
  const parsed = dashboardConfigSchema.safeParse(value ?? {});
  return parsed.success ? parsed.data : { ...emptyDashboardConfig };
}

/** Places a new widget below everything currently on the grid. */
export function appendWidget(
  config: DashboardConfig,
  instanceId: string,
  size: { w: number; h: number } = { w: 6, h: 6 },
): DashboardConfig {
  if (config.layout.some((item) => item.i === instanceId)) return config;

  const nextY = config.layout.reduce((max, item) => Math.max(max, item.y + item.h), 0);
  return {
    ...config,
    layout: [...config.layout, { i: instanceId, x: 0, y: nextY, w: size.w, h: size.h }],
    widgets: { ...config.widgets, [instanceId]: { clientOverride: null, viewConfig: null } },
  };
}

export function removeWidget(config: DashboardConfig, instanceId: string): DashboardConfig {
  const widgets = { ...config.widgets };
  delete widgets[instanceId];
  return { ...config, layout: config.layout.filter((item) => item.i !== instanceId), widgets };
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
  | 'density'
  | 'liveUpdates'
  | 'uiScale'
  | 'railFullHide'
  | 'cursorFollower'
>;

/** Merges dashboard-wide appearance/behavior settings (the gear panel), leaving layout/widgets untouched. */
export function updateGeneralSettings(config: DashboardConfig, patch: Partial<GeneralSettings>): DashboardConfig {
  return { ...config, ...patch };
}
