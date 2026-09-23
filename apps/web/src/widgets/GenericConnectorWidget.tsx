'use client';

import { strings, WidgetConnectionPlaceholder, WidgetShell } from '@eve/ui';
import type { JSX } from 'react';
import type { WidgetProps } from './types';
import { useWidgetData } from './useWidgetData';
import { StatCardsView } from './view/StatCardsView';
import { TableView } from './view/TableView';
import { useCellEditing } from './view/useCellEditing';
import { ViewConfigMenu } from './view/ViewConfigMenu';
import { resolveFields } from './view/resolve-fields';

/**
 * The fallback rendering for any connector without its own widget file.
 *
 * A future connector (Meta Ads, Google Ads) that implements `sync()` and
 * ideally `describeFields()` renders through here immediately — no new
 * `XyzWidget.tsx` required, no viewer/registry.tsx entry needed either.
 */
export function GenericConnectorWidget({ instanceId, title, viewConfig, onViewConfigChange }: WidgetProps): JSX.Element {
  const { data, loading, error, refresh, syncNow } = useWidgetData(instanceId);
  const editing = useCellEditing(instanceId, data, refresh);

  const canWrite = Boolean(data?.instance.capabilities.write);
  const allFields = data?.fields ?? [];
  const fields = resolveFields(allFields, viewConfig);
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
      footerExtra={data ? data.records.length + ' registros' : null}
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

      {kind === 'stat-cards' ? (
        <StatCardsView fields={fields} records={data?.records ?? []} />
      ) : (
        <TableView fields={fields} records={data?.records ?? []} editable={canWrite} editing={editing} />
      )}
    </WidgetShell>
  );
}
