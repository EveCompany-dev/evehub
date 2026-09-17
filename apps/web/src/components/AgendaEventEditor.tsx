'use client';

import { useState, type FormEvent, type JSX } from 'react';
import type { AgendaEventSummary } from './agenda-types';
import type { ClientOption } from './scheduling-types';
import { memberLabel, type JobMember } from './job-types';
import { useEscapeToClose } from './useEscapeToClose';

export interface AgendaEventEditorProps {
  clients: ClientOption[];
  members: JobMember[];
  currentUserId: string;
  /** null/undefined = creating a new event; a row = editing it. */
  initial?: AgendaEventSummary | null;
  defaultDate?: Date;
  onClose: () => void;
  onSaved: () => void;
}

function toLocalInputValue(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** Notion-style event form: title, description, when, who's in it, which client it's for. */
export function AgendaEventEditor({
  clients,
  members,
  currentUserId,
  initial,
  defaultDate,
  onClose,
  onSaved,
}: AgendaEventEditorProps): JSX.Element {
  useEscapeToClose(onClose);
  const isEditing = Boolean(initial);
  const canEdit = !isEditing || initial!.createdBy === currentUserId;

  const [title, setTitle] = useState(initial?.title ?? '');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [allDay, setAllDay] = useState(initial?.allDay ?? false);
  const [startAt, setStartAt] = useState(() => toLocalInputValue(initial ? new Date(initial.startAt) : (defaultDate ?? new Date())));
  const [endAt, setEndAt] = useState(() => (initial?.endAt ? toLocalInputValue(new Date(initial.endAt)) : ''));
  // Brand orange as the default rather than leaving this blank — an event
  // with no color looked broken/unstyled on the calendar instead of just
  // "the ordinary color everything starts as."
  const [color, setColor] = useState(initial?.color ?? '#fa5300');
  const [clientId, setClientId] = useState(initial?.clientId ?? '');
  const [attendeeIds, setAttendeeIds] = useState<Set<string>>(
    new Set(initial?.attendees.map((attendee) => attendee.user.id) ?? [currentUserId]),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggleAttendee = (userId: string) => {
    setAttendeeIds((current) => {
      const next = new Set(current);
      if (next.has(userId)) next.delete(userId);
      else next.add(userId);
      return next;
    });
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setError(null);

    const payload = {
      title: title.trim(),
      description: description.trim() || undefined,
      startAt: new Date(startAt).toISOString(),
      endAt: endAt ? new Date(endAt).toISOString() : null,
      allDay,
      color: color || null,
      clientId: clientId || null,
      attendeeIds: [...attendeeIds],
    };

    try {
      const response = isEditing
        ? await fetch(`/api/agenda/events/${initial!.id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          })
        : await fetch('/api/agenda/events', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ...payload, endAt: endAt ? new Date(endAt).toISOString() : undefined }),
          });

      const body = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) {
        setError(body.error ?? `HTTP ${response.status}`);
        return;
      }
      onSaved();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!initial) return;
    setBusy(true);
    try {
      const response = await fetch(`/api/agenda/events/${initial.id}`, { method: 'DELETE' });
      if (response.ok) onSaved();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="eve-modal-backdrop" onClick={onClose}>
      <form className="eve-modal" onClick={(event) => event.stopPropagation()} onSubmit={(event) => void submit(event)}>
        <h2 className="eve-card__title">{isEditing ? 'Editar evento' : 'Novo evento'}</h2>

        {error && <p className="eve-alert eve-alert--error">{error}</p>}

        <label className="eve-field">
          <span className="eve-field__label">Título</span>
          <input
            className="eve-input"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            disabled={!canEdit}
            required
          />
        </label>

        <label className="eve-field">
          <span className="eve-field__label">Descrição</span>
          <textarea
            className="eve-input eve-notes__textarea"
            rows={3}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            disabled={!canEdit}
          />
        </label>

        <label className="eve-check">
          <input type="checkbox" checked={allDay} onChange={(event) => setAllDay(event.target.checked)} disabled={!canEdit} />
          <span>Dia inteiro</span>
        </label>

        <label className="eve-field">
          <span className="eve-field__label">Início</span>
          <input
            className="eve-input"
            type={allDay ? 'date' : 'datetime-local'}
            value={allDay ? startAt.slice(0, 10) : startAt}
            onChange={(event) => setStartAt(allDay ? `${event.target.value}T00:00` : event.target.value)}
            disabled={!canEdit}
            required
          />
        </label>

        <label className="eve-field">
          <span className="eve-field__label">Fim (opcional)</span>
          <input
            className="eve-input"
            type={allDay ? 'date' : 'datetime-local'}
            value={allDay ? endAt.slice(0, 10) : endAt}
            onChange={(event) => setEndAt(allDay ? `${event.target.value}T00:00` : event.target.value)}
            disabled={!canEdit}
          />
        </label>

        <label className="eve-field">
          <span className="eve-field__label">Cliente</span>
          <select className="eve-input" value={clientId} onChange={(event) => setClientId(event.target.value)} disabled={!canEdit}>
            <option value="">Nenhum</option>
            {clients.map((client) => (
              <option key={client.id} value={client.id}>
                {client.label}
              </option>
            ))}
          </select>
        </label>

        <label className="eve-field">
          <span className="eve-field__label">Cor</span>
          <input
            className="eve-input"
            type="text"
            placeholder="#3B82F6"
            value={color}
            onChange={(event) => setColor(event.target.value)}
            disabled={!canEdit}
          />
        </label>

        <div className="eve-field">
          <span className="eve-field__label">Participantes</span>
          <div className="eve-agenda-editor__attendees">
            {members.map((member) => (
              <label key={member.id} className="eve-check">
                <input
                  type="checkbox"
                  checked={attendeeIds.has(member.id)}
                  onChange={() => toggleAttendee(member.id)}
                  disabled={!canEdit}
                />
                <span>{memberLabel(member)}</span>
              </label>
            ))}
          </div>
        </div>

        <div className="eve-profile__actions">
          {canEdit && (
            <button type="submit" className="eve-btn eve-btn--primary" disabled={busy}>
              {isEditing ? 'Salvar' : 'Criar evento'}
            </button>
          )}
          {isEditing && canEdit && (
            <button type="button" className="eve-btn eve-btn--danger" disabled={busy} onClick={() => void remove()}>
              Excluir
            </button>
          )}
          <button type="button" className="eve-btn" onClick={onClose} disabled={busy}>
            Fechar
          </button>
        </div>
      </form>
    </div>
  );
}
