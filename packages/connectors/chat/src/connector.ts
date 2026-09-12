import type { EveConnector, SyncResult } from '@eve/connector-sdk';
import { registerConnector } from '@eve/connector-sdk';
import { z } from 'zod';

const configSchema = z.object({});

export type ChatConfig = z.infer<typeof configSchema>;

/**
 * Registered purely so the widget catalog and the worker's sync schedule
 * treat it like any other connector. The actual Claude call lives server-side
 * in apps/web/src/app/api/instances/[id]/chat/route.ts, not here — a chat
 * turn isn't a "sync" or a field-patch "write", so this connector doesn't try
 * to force it through either of those.
 */
export const chatConnector: EveConnector<ChatConfig> = registerConnector<ChatConfig, undefined>({
  id: 'chat',
  label: 'Assistente (Claude)',
  description: 'Conversa simples com o Claude. Sem acesso a ferramentas/MCP ainda.',
  auth: 'none',
  capabilities: { read: true, write: false, webhook: false },
  defaultSize: { w: 6, h: 9, minW: 4, minH: 6 },
  configSchema,
  defaultConfig: {},

  async sync(): Promise<SyncResult> {
    return { ok: true, data: null };
  },
});
