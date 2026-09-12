'use client';

import { strings, UndoBanner, WidgetShell } from '@eve/ui';
import { useState, type JSX } from 'react';
import type { WidgetProps } from './types';
import { useWidgetData } from './useWidgetData';
import { StatCardsView } from './view/StatCardsView';
import { TableView } from './view/TableView';
import { useCellEditing } from './view/useCellEditing';
import { ViewConfigMenu } from './view/ViewConfigMenu';
import { resolveFields } from './view/resolve-fields';

/**
 * Renders entirely through the generic view engine, with no `describeFields`
 * of its own — a live test of the `autoDetectFields` fallback path any future
 * connector gets for free before bothering to declare a real field schema.
 */
export function DemoWidget({ instanceId, title, onRemove, viewConfig, onViewConfigChange }: WidgetProps): JSX.Element {
  const { data, loading, error, refresh, syncNow } = useWidgetData(instanceId);
  const editing = useCellEditing(instanceId, data, refresh);
  const [showViewConfig, setShowViewConfig] = useState(false);

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
      actions={[
        { label: strings.view.configure, onSelect: () => setShowViewConfig((value) => !value) },
        ...(lastEdit ? [{ label: strings.edit.undoLast, onSelect: () => void editing.undo(lastEdit.id) }] : []),
        { label: strings.dashboard.syncNow, onSelect: () => void syncNow() },
        { label: strings.dashboard.removeWidget, onSelect: onRemove, danger: true },
      ]}
      footerExtra={data ? data.records.length + ' clientes' : null}
    >
      {showViewConfig && (
        <ViewConfigMenu
          allFields={allFields}
          value={viewConfig}
          onChange={onViewConfigChange}
          onClose={() => setShowViewConfig(false)}
        />
      )}

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

      {kind === 'stat-cards' ? (
        <StatCardsView fields={fields} records={data?.records ?? []} />
      ) : (
        <TableView fields={fields} records={data?.records ?? []} editable={canWrite} editing={editing} />
      )}
    </WidgetShell>
  );
}
