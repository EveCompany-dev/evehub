'use client';

import { DEMO_STATUSES } from '@eve/connector-demo/shared';
import { strings, WidgetShell } from '@eve/ui';
import { useState, type JSX } from 'react';
import { useWidgetData, type WidgetRecord } from './useWidgetData';
import type { WidgetProps } from './types';

interface Pulse {
  impressions: number;
  ctr: number;
  activeCampaigns: number;
}

const EDITABLE = new Set(['status', 'owner', 'notes']);

function pulseOf(snapshotData: unknown): Pulse | null {
  if (!snapshotData || typeof snapshotData !== 'object') return null;
  const pulse = (snapshotData as { pulse?: Pulse }).pulse;
  return pulse && typeof pulse.impressions === 'number' ? pulse : null;
}

export function DemoWidget({ instanceId, title, onRemove }: WidgetProps): JSX.Element {
  const { data, loading, error, refresh, syncNow } = useWidgetData(instanceId);

  const [editing, setEditing] = useState<{ remoteId: string; field: string } | null>(null);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [conflict, setConflict] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const startEdit = (record: WidgetRecord, field: string) => {
    setConflict(null);
    setNotice(null);
    setEditing({ remoteId: record.remoteId, field });
    setDraft(String(record.data[field] ?? ''));
  };

  const save = async (record: WidgetRecord, field: string) => {
    setSaving(true);
    try {
      const response = await fetch(`/api/instances/${instanceId}/write`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          remoteId: record.remoteId,
          field,
          value: draft,
          // The version this row was rendered with. If the source moved on,
          // the server rejects the write instead of overwriting it.
          expectedVersion: record.remoteVersion,
        }),
      });

      const body = (await response.json().catch(() => ({}))) as { error?: string; message?: string; conflict?: boolean };

      if (response.status === 409 || body.conflict) {
        setConflict(body.message ?? strings.edit.conflict);
        return;
      }
      if (!response.ok) {
        setConflict(body.error ?? `HTTP ${response.status}`);
        return;
      }

      setEditing(null);
      await refresh();
    } finally {
      setSaving(false);
    }
  };

  const undo = async (editLogId: string) => {
    const response = await fetch(`/api/instances/${instanceId}/undo`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ editLogId }),
    });

    const body = (await response.json().catch(() => ({}))) as { error?: string; message?: string };
    setNotice(response.ok ? strings.edit.undone : (body.message ?? body.error ?? strings.edit.conflict));
    await refresh();
  };

  const pulse = pulseOf(data?.snapshot?.data);
  const lastEdit = data?.undoableEdits[0];

  return (
    <WidgetShell
      title={title}
      status={data?.instance.status ?? (loading ? 'syncing' : 'error')}
      statusMessage={data?.instance.statusMessage ?? error}
      lastSyncedAt={data?.instance.lastSyncedAt ?? null}
      actions={[
        { label: strings.dashboard.syncNow, onSelect: () => void syncNow() },
        { label: strings.dashboard.removeWidget, onSelect: onRemove, danger: true },
      ]}
      footerExtra={data ? `${data.records.length} clientes` : null}
    >
      {error && !data && (
        <div className="eve-alert eve-alert--error">
          <span>{strings.widget.loadError}</span>
          <button type="button" className="eve-btn eve-no-drag" onClick={() => void refresh()}>
            {strings.widget.retry}
          </button>
        </div>
      )}

      {conflict && (
        <div className="eve-alert eve-alert--error">
          <span>{conflict}</span>
          <button
            type="button"
            className="eve-btn eve-no-drag"
            onClick={() => {
              setConflict(null);
              setEditing(null);
              void refresh();
            }}
          >
            {strings.edit.reload}
          </button>
        </div>
      )}

      {notice && <div className="eve-alert">{notice}</div>}

      {lastEdit && (
        <div className="eve-alert">
          <span>
            {lastEdit.field} &rarr; {String(lastEdit.newValue)}
            {lastEdit.userName ? ` (${strings.edit.savedBy(lastEdit.userName)})` : ''}
          </span>
          <button type="button" className="eve-btn eve-no-drag" onClick={() => void undo(lastEdit.id)}>
            {strings.edit.undo}
          </button>
        </div>
      )}

      {pulse && (
        <div className="eve-stats">
          <div className="eve-stat">
            <span className="eve-stat__num">{pulse.impressions.toLocaleString('pt-BR')}</span>
            <span className="eve-stat__label">impressoes</span>
          </div>
          <div className="eve-stat">
            <span className="eve-stat__num">{pulse.ctr}%</span>
            <span className="eve-stat__label">ctr</span>
          </div>
          <div className="eve-stat">
            <span className="eve-stat__num">{pulse.activeCampaigns}</span>
            <span className="eve-stat__label">ativos</span>
          </div>
        </div>
      )}

      <div className="eve-table-wrap">
        <table className="eve-table">
          <thead>
            <tr>
              <th>Cliente</th>
              <th>Status</th>
              <th>Responsavel</th>
              <th>Obs.</th>
              <th className="eve-table__num">Invest.</th>
            </tr>
          </thead>
          <tbody>
            {(data?.records ?? []).map((record) => (
              <tr key={record.remoteId}>
                <td>{String(record.data.client ?? '-')}</td>

                {['status', 'owner', 'notes'].map((field) => {
                  const isEditing = editing?.remoteId === record.remoteId && editing.field === field;

                  return (
                    <td key={field}>
                      {isEditing ? (
                        <span className="eve-cell-edit eve-no-drag">
                          {field === 'status' ? (
                            <select className="eve-input" value={draft} onChange={(e) => setDraft(e.target.value)}>
                              {DEMO_STATUSES.map((status) => (
                                <option key={status} value={status}>
                                  {status}
                                </option>
                              ))}
                            </select>
                          ) : (
                            <input className="eve-input" value={draft} onChange={(e) => setDraft(e.target.value)} />
                          )}
                          <button
                            type="button"
                            className="eve-btn eve-btn--icon"
                            disabled={saving}
                            title={strings.edit.save}
                            onClick={() => void save(record, field)}
                          >
                            &#10003;
                          </button>
                          <button
                            type="button"
                            className="eve-btn eve-btn--icon"
                            title={strings.edit.cancel}
                            onClick={() => setEditing(null)}
                          >
                            &#10005;
                          </button>
                        </span>
                      ) : (
                        <span className="eve-cell">
                          {String(record.data[field] ?? '') || <span className="eve-dim">&mdash;</span>}
                          {data?.instance.capabilities.write && EDITABLE.has(field) && (
                            <button
                              type="button"
                              className="eve-btn eve-btn--icon eve-cell__pencil eve-no-drag"
                              title={strings.edit.edit}
                              onClick={() => startEdit(record, field)}
                            >
                              &#9998;
                            </button>
                          )}
                        </span>
                      )}
                    </td>
                  );
                })}

                <td className="eve-table__num">
                  {typeof record.data.spend === 'number'
                    ? record.data.spend.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
                    : '-'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </WidgetShell>
  );
}
