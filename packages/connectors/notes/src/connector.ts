import type { EveConnector, RemoteRecord, SyncResult, WritePatch, WriteResult } from '@eve/connector-sdk';
import { registerConnector } from '@eve/connector-sdk';
import { z } from 'zod';
import { getNoteStore, type NoteState } from './store';

const configSchema = z.object({});

export type NotesConfig = z.infer<typeof configSchema>;

const REMOTE_ID = 'note';

async function ensureState(instanceId: string): Promise<NoteState> {
  const store = getNoteStore();
  const existing = await store.load(instanceId);
  if (existing) return existing;

  const initial: NoteState = { text: '', version: '1' };
  await store.save(instanceId, initial);
  return initial;
}

function toRecord(state: NoteState): RemoteRecord {
  return { remoteId: REMOTE_ID, remoteVersion: state.version, data: { text: state.text } };
}

/**
 * A single free-text field, persisted through the same optimistic-lock write
 * path every other writable connector uses — the point being that the edit
 * engine built for Notion's table view (useCellEditing) works unmodified for
 * a single textarea too.
 */
export const notesConnector: EveConnector<NotesConfig> = registerConnector<NotesConfig, undefined>({
  id: 'notes',
  label: 'Notas',
  description: 'Bloco de notas simples, um texto por widget.',
  auth: 'none',
  capabilities: { read: true, write: true, webhook: false },
  defaultSize: { w: 5, h: 6, minW: 3, minH: 4 },
  configSchema,
  defaultConfig: {},

  async sync(ctx): Promise<SyncResult> {
    const state = await ensureState(ctx.instanceId);
    return { ok: true, data: null, records: [toRecord(state)] };
  },

  async write(ctx, patch: WritePatch): Promise<WriteResult> {
    const store = getNoteStore();
    const current = await ensureState(ctx.instanceId);

    if (current.version !== patch.expectedVersion) {
      return { ok: false, conflict: true, currentVersion: current.version, currentData: { text: current.text } };
    }

    const text = patch.patch.text;
    if (typeof text !== 'string') {
      return { ok: false, error: 'O campo "text" espera uma string.' };
    }

    const updated: NoteState = { text, version: String(Number(current.version) + 1) };
    await store.save(ctx.instanceId, updated);

    return { ok: true, newVersion: updated.version, data: { text: updated.text } };
  },

  async readVersion(ctx): Promise<string | null> {
    const state = await ensureState(ctx.instanceId);
    return state.version;
  },
});
