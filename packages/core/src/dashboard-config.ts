import { z } from 'zod';

/** One tile on the 12-column grid. `i` is the ConnectorInstance id. */
export const widgetLayoutSchema = z.object({
  i: z.string().min(1),
  x: z.number().int().min(0),
  y: z.number().int().min(0),
  w: z.number().int().min(1).max(12),
  h: z.number().int().min(1).max(40),
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
});

export const dashboardConfigSchema = z.object({
  layout: z.array(widgetLayoutSchema).default([]),
  widgets: z.record(z.string(), widgetSettingsSchema).default({}),
  theme: z.enum(['dark', 'light', 'system']).default('system'),
  activeClient: z.string().nullable().default(null),
  /** Trava arrastar/redimensionar, para nao desmontar o layout sem querer. */
  locked: z.boolean().default(false),
});

export type WidgetLayout = z.infer<typeof widgetLayoutSchema>;
export type WidgetSettings = z.infer<typeof widgetSettingsSchema>;
export type DashboardConfig = z.infer<typeof dashboardConfigSchema>;

export const emptyDashboardConfig: DashboardConfig = {
  layout: [],
  widgets: {},
  theme: 'system',
  activeClient: null,
  locked: false,
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
    widgets: { ...config.widgets, [instanceId]: { clientOverride: null } },
  };
}

export function removeWidget(config: DashboardConfig, instanceId: string): DashboardConfig {
  const widgets = { ...config.widgets };
  delete widgets[instanceId];
  return { ...config, layout: config.layout.filter((item) => item.i !== instanceId), widgets };
}
