import { z } from 'zod';

/**
 * How a widget's synced data renders, chosen by the user from the widget's
 * own menu — not by editing any widget component. `fields: null` means "show
 * every field the connector/auto-detection reports" (up to the view's own
 * cap); an explicit array is both the subset AND the display order.
 *
 * Lives in its own module so the dashboard config (and anything else that
 * stores a widget view) can import it without pulling the rest along.
 */
export const viewConfigSchema = z.object({
  kind: z.enum(['table', 'stat-cards']).default('table'),
  fields: z.array(z.string()).nullable().default(null),
  /**
   * A widget's own settings from its settings card (Resumo do dia's
   * sections, the list a Tarefas widget shows, ...). Lives here, in the
   * user's dashboard config, so it follows them across devices — unlike the
   * older per-browser localStorage flags. Keys are owned by each widget;
   * values stay flat and small on purpose.
   */
  options: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])).optional(),
});

export type ViewConfig = z.infer<typeof viewConfigSchema>;

export type ViewOptionValue = string | number | boolean | null;

/** Returns a copy of `view` (or a default view) with one option set — the rest of the view untouched. */
export function withViewOption(view: ViewConfig | null, key: string, value: ViewOptionValue): ViewConfig {
  const base: ViewConfig = view ?? { kind: 'table', fields: null };
  return { ...base, options: { ...base.options, [key]: value } };
}

/** Reads one option, falling back when it is unset or holds a value of another type. */
export function readViewOption<T extends ViewOptionValue>(view: ViewConfig | null, key: string, fallback: T): T {
  const value = view?.options?.[key];
  if (value === undefined) return fallback;
  if (fallback !== null && value !== null && typeof value !== typeof fallback) return fallback;
  return value as T;
}
