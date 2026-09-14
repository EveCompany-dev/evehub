'use client';

import { strings, UndoBanner, WidgetShell } from '@eve/ui';
import { useState, type JSX } from 'react';
import { renderRichText } from '../components/RichText';
import { useFormattingToolbar } from '../components/useFormattingToolbar';
import type { WidgetProps } from './types';
import { useWidgetData } from './useWidgetData';
import { useCellEditing } from './view/useCellEditing';

/**
 * A single free-text field, rendered as a textarea instead of TableView's
 * grid — but the edit/save/conflict/undo machinery underneath is the exact
 * same `useCellEditing` hook every table-shaped widget uses.
 *
 * Click-to-edit-in-place (same pattern as the Job description field in
 * JobDetailModal) rather than WidgetShell's pencil-toggle affordance — a note
 * is meant for quick jotting, so there's no separate "enter edit mode" step:
 * click the text, type, blur (or Escape) to leave. `useCellEditing`'s
 * draft/save plumbing is independent of its own `editing` flag, so it still
 * drives the save here even though that flag itself goes unused.
 */
export function NotesWidget({ instanceId, title, onRemove }: WidgetProps): JSX.Element {
  const { data, loading, error, refresh, syncNow } = useWidgetData(instanceId);
  const editing = useCellEditing(instanceId, data, refresh);
  const [editingText, setEditingText] = useState(false);

  const record = data?.records[0];
  const lastEdit = data?.undoableEdits[0];

  const textValue = record ? editing.valueOf(record, 'text') : '';
  const { textareaRef, toolbar } = useFormattingToolbar(textValue, (next) => record && editing.setValue(record, 'text', next));

  return (
    <WidgetShell
      title={title}
      status={data?.instance.status ?? (loading ? 'syncing' : 'error')}
      statusMessage={data?.instance.statusMessage ?? error}
      lastSyncedAt={data?.instance.lastSyncedAt ?? null}
      actions={[
        ...(lastEdit ? [{ label: strings.edit.undoLast, onSelect: () => void editing.undo(lastEdit.id) }] : []),
        { label: strings.dashboard.syncNow, onSelect: () => void syncNow() },
        { label: strings.dashboard.removeWidget, onSelect: onRemove, danger: true },
      ]}
    >
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

      {lastEdit && !editingText && (
        <UndoBanner
          editId={lastEdit.id}
          field={lastEdit.field}
          newValue={String(lastEdit.newValue ?? '')}
          userName={lastEdit.userName}
          onUndo={() => void editing.undo(lastEdit.id)}
        />
      )}

      {record &&
        (editingText ? (
          <>
            <textarea
              ref={textareaRef}
              className="eve-input eve-notes__textarea eve-no-drag"
              value={textValue}
              onChange={(event) => editing.setValue(record, 'text', event.target.value)}
              autoFocus
              onBlur={() => {
                setEditingText(false);
                void editing.saveAll();
              }}
              onKeyDown={(event) => {
                if (event.key === 'Escape') {
                  editing.discardValue(record, 'text');
                  setEditingText(false);
                }
              }}
            />
            {toolbar}
          </>
        ) : (
          <div className="eve-notes__text eve-no-drag" onClick={() => setEditingText(true)}>
            {String(record.data.text ?? '')
              ? renderRichText(String(record.data.text ?? ''))
              : <span className="eve-dim">{strings.edit.editHint}</span>}
          </div>
        ))}
    </WidgetShell>
  );
}
