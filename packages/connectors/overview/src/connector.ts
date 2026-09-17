import type { EveConnector, SyncResult } from '@eve/connector-sdk';
import { registerConnector } from '@eve/connector-sdk';
import { z } from 'zod';

const configSchema = z.object({});

export type OverviewConfig = z.infer<typeof configSchema>;

/**
 * No upstream, no data, no write — same as the calculator connector.
 * Registering it as a real connector (rather than special-casing it in the
 * dashboard) is what lets it show up in the normal "+ add widget" catalog and
 * live on the grid like everything else. Its widget reads straight
 * from this app's own notifications and scheduling APIs client-side; there
 * is nothing for the worker to sync.
 */
export const overviewConnector: EveConnector<OverviewConfig> = registerConnector<OverviewConfig, undefined>({
  id: 'overview',
  label: 'Resumo do dia',
  description: 'Notificações importantes e os compromissos de hoje na Agenda, num só lugar.',
  category: 'local',
  auth: 'none',
  capabilities: { read: true, write: false, webhook: false },
  defaultSize: { w: 4, h: 8, minW: 3, minH: 6 },
  configSchema,
  defaultConfig: {},

  async sync(): Promise<SyncResult> {
    return { ok: true, data: null };
  },
});
