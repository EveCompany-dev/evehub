'use client';

import type { NotionSnapshot } from '@eve/connector-notion/shared';
import { strings, UndoBanner, WidgetConnectionPlaceholder, WidgetShell } from '@eve/ui';
import type { JSX } from 'react';
import type { WidgetProps } from './types';
import { useWidgetData } from './useWidgetData';
import { StatCardsView } from './view/StatCardsView';
import { TableView } from './view/TableView';
import { useCellEditing } from './view/useCellEditing';
import { ViewConfigMenu } from './view/ViewConfigMenu';
import { resolveFields } from './view/resolve-fields';

function snapshotOf(data: unknown): NotionSnapshot | null {
  if (!data || typeof data !== 'object') return null;
  const snapshot = data as NotionSnapshot;
  return Array.isArray(snapshot.properties) ? snapshot : null;
}

export function NotionWidget({ instanceId, title, viewConfig, onViewConfigChange }: WidgetProps): JSX.Element {
  const { data, loading, error, refresh, syncNow } = useWidgetData(instanceId);
  const editing = useCellEditing(instanceId, data, refresh);

  const snapshot = snapshotOf(data?.snapshot?.data);
  const canWrite = Boolean(data?.instance.capabilities.write);
  const allFields = data?.fields ?? [];
  const fields = resolveFields(allFields, viewConfig);

  const lastEdit = data?.undoableEdits[0];
  const kind = viewConfig?.kind ?? 'table';

  return (
    <WidgetShell
      title={title}
      status={data?.instance.status ?? (loading ? 'syncing' : 'error')}
      statusMessage={data?.instance.statusMessage ?? error}
      lastSyncedAt={data?.instance.lastSyncedAt ?? null}
      editable={canWrite && fields.some((field) => field.writable)}
      editing={editing.editing}
      onToggleEdit={editing.toggleEdit}
      settings={{
        geral: <ViewConfigMenu allFields={allFields} value={viewConfig} onChange={onViewConfigChange} />,
        conexao: <WidgetConnectionPlaceholder />,
      }}
      onSyncNow={syncNow}
      onUndoLast={lastEdit ? () => void editing.undo(lastEdit.id) : null}
      footerExtra={snapshot ? snapshot.rowCount + ' linhas' : null}
    >
      {editing.editing && (
        <div className="eve-alert eve-editbar eve-no-drag">
          <span>{editing.isDirty ? strings.edit.pendingChanges : strings.edit.editHint}</span>
          <span className="eve-editbar__actions">
            <button
              type="button"
              className="eve-btn eve-btn--primary"
              disabled={editing.saving || !editing.isDirty}
              onClick={() => void editing.saveAll()}
            >
              {editing.saving ? strings.edit.saving : strings.edit.save}
            </button>
            <button type="button" className="eve-btn" onClick={editing.toggleEdit}>
              {strings.edit.cancel}
            </button>
          </span>
        </div>
      )}

      {error && !data && (
        <div className="eve-alert eve-alert--error">
          <span>{strings.widget.loadError}</span>
          <button type="button" className="eve-btn eve-no-drag" onClick={() => void refresh()}>
            {strings.widget.retry}
          </button>
        </div>
      )}

      {/* O erro do connector (token, compartilhamento) e mais util que qualquer
          mensagem generica nossa, entao ele aparece inteiro. */}
      {data?.instance.status === 'error' && data.instance.statusMessage && (
        <div className="eve-alert eve-alert--error">
          <span>{data.instance.statusMessage}</span>
          <button type="button" className="eve-btn eve-no-drag" onClick={() => void syncNow()}>
            {strings.widget.retry}
          </button>
        </div>
      )}

      {editing.conflict && (
        <div className="eve-alert eve-alert--error">
          <span>{editing.conflict}</span>
          <button type="button" className="eve-btn eve-no-drag" onClick={editing.dismissConflict}>
            {strings.edit.reload}
          </button>
        </div>
      )}

      {editing.notice && <div className="eve-alert">{editing.notice}</div>}

      {lastEdit && !editing.editing && (
        <UndoBanner
          editId={lastEdit.id}
          field={lastEdit.field}
          newValue={String(lastEdit.newValue ?? '')}
          userName={lastEdit.userName}
          onUndo={() => void editing.undo(lastEdit.id)}
        />
      )}

      {snapshot?.truncated && <div className="eve-alert">{strings.notion.truncated}</div>}

      {kind === 'stat-cards' ? (
        <StatCardsView fields={fields} records={data?.records ?? []} />
      ) : (
        <TableView fields={fields} records={data?.records ?? []} editable={canWrite} editing={editing} />
      )}
    </WidgetShell>
  );
}
