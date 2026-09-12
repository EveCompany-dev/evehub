'use client';

import { strings, UndoBanner, WidgetShell } from '@eve/ui';
import type { JSX } from 'react';
import type { WidgetProps } from './types';
import { useWidgetData } from './useWidgetData';
import { useCellEditing } from './view/useCellEditing';

/**
 * A single free-text field, rendered as a textarea instead of TableView's
 * grid — but the edit/save/conflict/undo machinery underneath is the exact
 * same `useCellEditing` hook every table-shaped widget uses.
 */
export function NotesWidget({ instanceId, title, onRemove }: WidgetProps): JSX.Element {
  const { data, loading, error, refresh, syncNow } = useWidgetData(instanceId);
  const editing = useCellEditing(instanceId, data, refresh);

  const record = data?.records[0];
  const lastEdit = data?.undoableEdits[0];

  return (
    <WidgetShell
      title={title}
      status={data?.instance.status ?? (loading ? 'syncing' : 'error')}
      statusMessage={data?.instance.statusMessage ?? error}
      lastSyncedAt={data?.instance.lastSyncedAt ?? null}
      editable={Boolean(record)}
      editing={editing.editing}
      onToggleEdit={editing.toggleEdit}
      actions={[
        ...(lastEdit ? [{ label: strings.edit.undoLast, onSelect: () => void editing.undo(lastEdit.id) }] : []),
        { label: strings.dashboard.syncNow, onSelect: () => void syncNow() },
        { label: strings.dashboard.removeWidget, onSelect: onRemove, danger: true },
      ]}
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

      {record &&
        (editing.editing ? (
          <textarea
            className="eve-input eve-notes__textarea eve-no-drag"
            value={editing.valueOf(record, 'text')}
            onChange={(event) => editing.setValue(record, 'text', event.target.value)}
            autoFocus
          />
        ) : (
          <p className="eve-notes__text">
            {String(record.data.text ?? '') || <span className="eve-dim">{strings.edit.editHint}</span>}
          </p>
        ))}
    </WidgetShell>
  );
}
