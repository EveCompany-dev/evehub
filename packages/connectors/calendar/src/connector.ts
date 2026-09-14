import type { EveConnector, SyncResult } from '@eve/connector-sdk';
import { registerConnector } from '@eve/connector-sdk';
import { z } from 'zod';

const configSchema = z.object({});

export type CalendarConfig = z.infer<typeof configSchema>;

/**
 * Plain calendar node — no data, no other purpose yet. Same "real connector
 * just for the catalog/grid" shape as calculator.
 */
export const calendarConnector: EveConnector<CalendarConfig> = registerConnector<CalendarConfig, undefined>({
  id: 'calendar',
  label: 'Calendário',
  description: 'Calendário simples, sem eventos ou integração (por enquanto).',
  category: 'local',
  auth: 'none',
  capabilities: { read: true, write: false, webhook: false },
  defaultSize: { w: 5, h: 6, minW: 4, minH: 5 },
  configSchema,
  defaultConfig: {},

  async sync(): Promise<SyncResult> {
    return { ok: true, data: null };
  },
});
