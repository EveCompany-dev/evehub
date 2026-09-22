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
});

export type ViewConfig = z.infer<typeof viewConfigSchema>;
