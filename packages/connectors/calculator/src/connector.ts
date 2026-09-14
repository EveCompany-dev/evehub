import type { EveConnector, SyncResult } from '@eve/connector-sdk';
import { registerConnector } from '@eve/connector-sdk';
import { z } from 'zod';

const configSchema = z.object({});

export type CalculatorConfig = z.infer<typeof configSchema>;

/**
 * No upstream, no data, no write. Registering it as a real connector — rather
 * than special-casing it in the dashboard — is what lets it show up in the
 * normal "+ add widget" catalog and live on the grid like everything else.
 */
export const calculatorConnector: EveConnector<CalculatorConfig> = registerConnector<CalculatorConfig, undefined>({
  id: 'calculator',
  label: 'Calculadora',
  description: 'Calculadora simples de quatro operações, sem dado nenhum para sincronizar.',
  category: 'local',
  auth: 'none',
  // read:true is a formality: runSync() refuses to call sync() on a connector
  // that declares no read capability, and every instance gets synced once at
  // creation plus on the worker's schedule.
  capabilities: { read: true, write: false, webhook: false },
  defaultSize: { w: 4, h: 6, minW: 3, minH: 5 },
  configSchema,
  defaultConfig: {},

  async sync(): Promise<SyncResult> {
    return { ok: true, data: null };
  },
});
