'use client';

import { strings } from '@eve/ui';
import { useState } from 'react';
import type { WidgetData, WidgetRecord } from '../useWidgetData';

export interface CellEditingApi {
  editing: boolean;
  toggleEdit: () => void;
  saving: boolean;
  isDirty: boolean;
  conflict: string | null;
  notice: string | null;
  valueOf: (record: WidgetRecord, field: string) => string;
  setValue: (record: WidgetRecord, field: string, value: string) => void;
  saveAll: () => Promise<void>;
  undo: (editLogId: string) => Promise<void>;
  dismissConflict: () => void;
}

const draftKey = (remoteId: string, field: string): string => remoteId + ':' + field;

/**
 * Draft/save/conflict/undo state machine shared by every editable widget.
 *
 * Extracted from what used to be duplicated near byte-for-byte between
 * NotionWidget and DemoWidget: one write per dirty field, optimistic-lock
 * versions threaded through a batch so a second edit to the same row reuses
 * the version the first write just produced, and a 409 aborts the rest of the
 * batch rather than applying it partially.
 */
export function useCellEditing(
  instanceId: string,
  data: WidgetData | null,
  refresh: () => Promise<void>,
): CellEditingApi {
  const [editing, setEditing] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [conflict, setConflict] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const toggleEdit = (): void => {
    setConflict(null);
    setNotice(null);
    setDrafts({});
    setEditing((value) => !value);
  };

  const valueOf = (record: WidgetRecord, field: string): string =>
    drafts[draftKey(record.remoteId, field)] ?? String(record.data[field] ?? '');

  const setValue = (record: WidgetRecord, field: string, value: string): void => {
    setDrafts((current) => ({ ...current, [draftKey(record.remoteId, field)]: value }));
  };

  const isDirty = Object.keys(drafts).length > 0;

  const saveAll = async (): Promise<void> => {
    if (!data || !isDirty) {
      setEditing(false);
      return;
    }

    setSaving(true);
    setConflict(null);

    try {
      const versions = new Map(data.records.map((record) => [record.remoteId, record.remoteVersion]));

      for (const [key, value] of Object.entries(drafts)) {
        const separator = key.indexOf(':');
        const remoteId = key.slice(0, separator);
        const field = key.slice(separator + 1);

        const expectedVersion = versions.get(remoteId);
        if (!expectedVersion) continue;

        const response = await fetch('/api/instances/' + instanceId + '/write', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ remoteId, field, value, expectedVersion }),
        });

        const body = (await response.json().catch(() => ({}))) as {
          error?: string;
          message?: string;
          conflict?: boolean;
          newVersion?: string;
        };

        if (response.status === 409 || body.conflict) {
          setConflict(body.message ?? strings.edit.conflict);
          await refresh();
          return;
        }
        if (!response.ok) {
          setConflict(body.error ?? 'HTTP ' + response.status);
          return;
        }

        if (body.newVersion) versions.set(remoteId, body.newVersion);
      }

      setDrafts({});
      setEditing(false);
      await refresh();
    } finally {
      setSaving(false);
    }
  };

  const undo = async (editLogId: string): Promise<void> => {
    const response = await fetch('/api/instances/' + instanceId + '/undo', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ editLogId }),
    });
    const body = (await response.json().catch(() => ({}))) as { error?: string; message?: string };
    setNotice(response.ok ? strings.edit.undone : (body.message ?? body.error ?? strings.edit.conflict));
    await refresh();
  };

  const dismissConflict = (): void => {
    setConflict(null);
    setDrafts({});
    void refresh();
  };

  return { editing, toggleEdit, saving, isDirty, conflict, notice, valueOf, setValue, saveAll, undo, dismissConflict };
}
