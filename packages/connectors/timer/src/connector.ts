import type { EveConnector, SyncResult } from '@eve/connector-sdk';
import { registerConnector } from '@eve/connector-sdk';
import { z } from 'zod';

const configSchema = z.object({});

export type TimerConfig = z.infer<typeof configSchema>;

/**
 * No upstream, no data, no write — same shape as the calculator. The countdown
 * lives entirely in the widget; registering it as a connector is only what
 * puts it in the "+ add widget" catalog and on the grid.
 */
export const timerConnector: EveConnector<TimerConfig> = registerConnector<TimerConfig, undefined>({
  id: 'timer',
  label: 'Timer',
  description: 'Cronômetro regressivo de foco e intervalo, com modo Pomodoro (25 + 5 minutos).',
  category: 'local',
  auth: 'none',
  capabilities: { read: true, write: false, webhook: false },
  defaultSize: { w: 3, h: 7, minW: 3, minH: 6 },
  configSchema,
  defaultConfig: {},

  async sync(): Promise<SyncResult> {
    return { ok: true, data: null };
  },
});
