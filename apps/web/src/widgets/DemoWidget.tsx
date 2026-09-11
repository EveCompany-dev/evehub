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
const COLUMNS = ['status', 'owner', 'notes'] as const;

function pulseOf(snapshotData: unknown): Pulse | null {
  if (!snapshotData || typeof snapshotData !== 'object') return null;
  const pulse = (snapshotData as { pulse?: Pulse }).pulse;
  return pulse && typeof pulse.impressions === 'number' ? pulse : null;
}

export function DemoWidget({ instanceId, title, onRemove }: WidgetProps): JSX.Element {
  const { data, loading, error, refresh, syncNow } = useWidgetData(instanceId);

  // Edicao e do widget inteiro, num unico botao no cabecalho — em vez de um
  // lapis por celula, que com vinte linhas vira ruido visual.
  const [editing, setEditing] = useState(false);
  // Alteracoes pendentes, chaveadas por "<remoteId>:<campo>".
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [conflict, setConflict] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const draftKey = (remoteId: string, field: string) => remoteId + ':' + field;

  const toggleEdit = () => {
    setConflict(null);
    setNotice(null);
    setDrafts({});
    setEditing((value) => !value);
  };

  const valueOf = (record: WidgetRecord, field: string): string =>
    drafts[draftKey(record.remoteId, field)] ?? String(record.data[field] ?? '');

  const isDirty = Object.keys(drafts).length > 0;

  /**
   * Grava so o que mudou, um write por campo.
   *
   * A trava otimista e por registro, entao cada escrita carrega o
   * `remoteVersion` da linha que o usuario viu. Se alguma conflitar, o lote
   * para ali e recarrega — melhor do que aplicar metade das mudancas.
   */
  const saveAll = async () => {
    if (!data || !isDirty) {
      setEditing(false);
      return;
    }

    setSaving(true);
    setConflict(null);

    try {
      // Dois campos da mesma linha: o segundo precisa da versao que o
      // primeiro acabou de gerar.
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

  const undo = async (editLogId: string) => {
    const response = await fetch('/api/instances/' + instanceId + '/undo', {
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
  const canWrite = Boolean(data?.instance.capabilities.write);

  return (
    <WidgetShell
      title={title}
      status={data?.instance.status ?? (loading ? 'syncing' : 'error')}
      statusMessage={data?.instance.statusMessage ?? error}
      lastSyncedAt={data?.instance.lastSyncedAt ?? null}
      editable={canWrite}
      editing={editing}
      onToggleEdit={toggleEdit}
      actions={[
        { label: strings.dashboard.syncNow, onSelect: () => void syncNow() },
        { label: strings.dashboard.removeWidget, onSelect: onRemove, danger: true },
      ]}
      footerExtra={data ? data.records.length + ' clientes' : null}
    >
      {editing && (
        <div className="eve-alert eve-editbar eve-no-drag">
          <span>{isDirty ? strings.edit.pendingChanges : strings.edit.editHint}</span>
          <span className="eve-editbar__actions">
            <button
              type="button"
              className="eve-btn eve-btn--primary"
              disabled={saving || !isDirty}
              onClick={() => void saveAll()}
            >
              {saving ? strings.edit.saving : strings.edit.save}
            </button>
            <button type="button" className="eve-btn" onClick={toggleEdit}>
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

      {conflict && (
        <div className="eve-alert eve-alert--error">
          <span>{conflict}</span>
          <button
            type="button"
            className="eve-btn eve-no-drag"
            onClick={() => {
              setConflict(null);
              setDrafts({});
              void refresh();
            }}
          >
            {strings.edit.reload}
          </button>
        </div>
      )}

      {notice && <div className="eve-alert">{notice}</div>}

      {lastEdit && !editing && (
        <div className="eve-alert">
          <span>
            {lastEdit.field} &rarr; {String(lastEdit.newValue)}
            {lastEdit.userName ? ' (' + strings.edit.savedBy(lastEdit.userName) + ')' : ''}
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

                {COLUMNS.map((field) => (
                  <td key={field}>
                    {editing && EDITABLE.has(field) ? (
                      <span className="eve-cell-edit eve-no-drag">
                        {field === 'status' ? (
                          <select
                            className="eve-input"
                            value={valueOf(record, field)}
                            onChange={(event) =>
                              setDrafts({ ...drafts, [draftKey(record.remoteId, field)]: event.target.value })
                            }
                          >
                            {DEMO_STATUSES.map((status) => (
                              <option key={status} value={status}>
                                {status}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <input
                            className="eve-input"
                            value={valueOf(record, field)}
                            onChange={(event) =>
                              setDrafts({ ...drafts, [draftKey(record.remoteId, field)]: event.target.value })
                            }
                          />
                        )}
                      </span>
                    ) : (
                      <span className="eve-cell">
                        {String(record.data[field] ?? '') || <span className="eve-dim">&mdash;</span>}
                      </span>
                    )}
                  </td>
                ))}

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
