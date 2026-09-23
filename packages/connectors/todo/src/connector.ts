import type { EveConnector, SyncResult } from '@eve/connector-sdk';
import { registerConnector } from '@eve/connector-sdk';
import { z } from 'zod';

const configSchema = z.object({});

export type TodoConfig = z.infer<typeof configSchema>;

/**
 * Registering "Tarefas" as a connector is only what puts it in the add-widget
 * catalog and on the grid — same shape as timer and calculator: no upstream,
 * no sync data, no credentials.
 *
 * The lists themselves are NOT connector data. They are personal rows
 * (TodoList/TodoItem, one owner each) behind /api/todos, so one instance on a
 * shared workspace still shows every person only their own tasks.
 */
export const todoConnector: EveConnector<TodoConfig> = registerConnector<TodoConfig, undefined>({
  id: 'todo',
  label: 'Tarefas',
  description: 'Sua lista de tarefas pessoal: digite para adicionar, com @menções e /links. Só você vê.',
  category: 'local',
  auth: 'none',
  capabilities: { read: true, write: false, webhook: false },
  defaultSize: { w: 4, h: 8, minW: 3, minH: 5 },
  configSchema,
  defaultConfig: {},

  async sync(): Promise<SyncResult> {
    return { ok: true, data: null };
  },
});
