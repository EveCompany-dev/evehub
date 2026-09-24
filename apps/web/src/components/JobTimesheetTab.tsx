'use client';

import { strings, X } from '@eve/ui';
import { useCallback, useEffect, useState, type JSX } from 'react';
import {
  durationMinutes,
  formatDateTimePtBr,
  formatDuration,
  memberInitials,
  memberLabel,
  type TimeEntrySummary,
} from './job-types';

export interface JobTimesheetTabProps {
  jobId: string;
  /** Edit/delete show only on your own entries — the API enforces the same (admins excepted). */
  currentUserId: string;
}

interface EntriesResponse {
  entries?: TimeEntrySummary[];
  error?: string;
}

function totalMinutes(entries: TimeEntrySummary[]): number {
  return entries.reduce((total, entry) => total + durationMinutes(entry.startedAt, entry.endedAt), 0);
}

function formatMinutes(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return hours > 0 ? `${hours}h ${String(rest).padStart(2, '0')}m` : `${rest}m`;
}

/**
 * Read-only log of finished time recordings, editable in place. Starting or
 * stopping a timer happens from the job's main panel (or the floating popup)
 * now — this tab is purely "what got logged, and can I fix the number."
 */
export function JobTimesheetTab({ jobId, currentUserId }: JobTimesheetTabProps): JSX.Element {
  const [entries, setEntries] = useState<TimeEntrySummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch(`/api/jobs/${jobId}/time-entries`, { cache: 'no-store' });
      const body = (await response.json().catch(() => ({}))) as EntriesResponse;
      if (!response.ok || !body.entries) {
        setError(body.error ?? `HTTP ${response.status}`);
        return;
      }
      setEntries(body.entries.filter((entry) => entry.endedAt !== null));
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  }, [jobId]);

  useEffect(() => {
    // Mount fetch — setState happens after an await, same case as
    // useWidgetData.ts's initial fetch.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const startEdit = (entry: TimeEntrySummary) => {
    setEditingId(entry.id);
    setEditValue(String(durationMinutes(entry.startedAt, entry.endedAt)));
  };

  const saveEdit = async (entryId: string) => {
    const minutes = Number(editValue);
    if (!Number.isFinite(minutes) || minutes <= 0) {
      // Returning quietly left the editor open with the value still in it, so
      // nothing distinguished "rejected" from "the button didn't register".
      setError('Informe a duração em minutos, maior que zero.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const response = await fetch(`/api/jobs/${jobId}/time-entries/${entryId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ durationMinutes: Math.round(minutes) }),
      });
      const body = (await response.json().catch(() => ({}))) as { entry?: TimeEntrySummary; error?: string };
      if (!response.ok || !body.entry) {
        setError(body.error ?? `HTTP ${response.status}`);
        return;
      }
      setEntries((current) => current.map((entry) => (entry.id === entryId ? body.entry! : entry)));
      setEditingId(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSaving(false);
    }
  };

  const removeEntry = async (entryId: string) => {
    setError(null);
    try {
      const response = await fetch(`/api/jobs/${jobId}/time-entries/${entryId}`, { method: 'DELETE' });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        setError(body.error ?? `HTTP ${response.status}`);
        return;
      }
      setEntries((current) => current.filter((entry) => entry.id !== entryId));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  if (loading) return <p className="eve-dim">Carregando...</p>;

  return (
    <div className="eve-jobs__timesheet">
      {error && <p className="eve-alert eve-alert--error">{error}</p>}

      {entries.length > 0 && <p className="eve-dim">{strings.jobs.timesheetTotal(formatMinutes(totalMinutes(entries)))}</p>}

      {entries.length === 0 ? (
        <p className="eve-dim">{strings.jobs.timesheetEmpty}</p>
      ) : (
        <ul className="eve-jobs__timesheet-log">
          {entries.map((entry) => (
            <li key={entry.id} className="eve-jobs__timesheet-entry">
              <span className="eve-avatar eve-avatar--fallback" style={{ width: 20, height: 20, fontSize: 9 }}>
                {memberInitials(entry.user)}
              </span>
              <span>{memberLabel(entry.user)}</span>
              <span className="eve-dim">{entry.task?.title ?? strings.jobs.timesheetGeneral}</span>
              <span className="eve-dim">{formatDateTimePtBr(entry.startedAt)}</span>

              {editingId === entry.id ? (
                <span className="eve-jobs__timesheet-edit">
                  <input
                    className="eve-input eve-jobs__timesheet-edit-input"
                    type="number"
                    min={1}
                    autoFocus
                    value={editValue}
                    onChange={(event) => setEditValue(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') void saveEdit(entry.id);
                      if (event.key === 'Escape') setEditingId(null);
                    }}
                  />
                  <span className="eve-dim">{strings.jobs.timesheetMinutesLabel}</span>
                  <button type="button" className="eve-btn eve-btn--primary" disabled={saving} onClick={() => void saveEdit(entry.id)}>
                    {strings.edit.save}
                  </button>
                  <button type="button" className="eve-btn" onClick={() => setEditingId(null)}>
                    {strings.edit.cancel}
                  </button>
                </span>
              ) : entry.userId === currentUserId ? (
                <button
                  type="button"
                  className="eve-jobs__timesheet-duration"
                  title={strings.jobs.timesheetEdit}
                  onClick={() => startEdit(entry)}
                >
                  {formatDuration(entry.startedAt, entry.endedAt)}
                </button>
              ) : (
                // Someone else's hours: visible to everyone, editable only by them.
                <span className="eve-jobs__timesheet-duration">{formatDuration(entry.startedAt, entry.endedAt)}</span>
              )}

              {entry.userId === currentUserId && (
                <button
                  type="button"
                  className="eve-btn eve-btn--icon"
                  title={strings.jobs.deleteEntry}
                  onClick={() => void removeEntry(entry.id)}
                >
                  <X size={14} aria-hidden="true" />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
