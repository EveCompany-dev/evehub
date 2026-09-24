'use client';

import { useState, type FormEvent, type JSX } from 'react';
import type { AgendaCalendar, AgendaEventSummary } from './agenda-types';
import { ConfirmButton } from './ConfirmButton';
import { memberLabel, type JobMember } from './job-types';
import type { ClientOption } from './scheduling-types';
import { useEscapeToClose } from './useEscapeToClose';

export interface AgendaEventEditorProps {
  calendars: AgendaCalendar[];
  clients: ClientOption[];
  members: JobMember[];
  /** null/undefined = creating a new appointment; a row = editing it. */
  initial?: AgendaEventSummary | null;
  defaultDate?: Date;
  onClose: () => void;
  onSaved: () => void;
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

function toLocalInputValue(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** An all-day event's last day, from Google's exclusive end ("" when it is a single day). */
function lastDayOf(event: AgendaEventSummary): string {
  if (!event.end) return '';
  const last = new Date(`${event.end.slice(0, 10)}T00:00:00.000Z`);
  last.setUTCDate(last.getUTCDate() - 1);
  const day = last.toISOString().slice(0, 10);
  return day > event.start.slice(0, 10) ? `${day}T09:00` : '';
}

/** Noon keeps an all-day date the same day in every time zone on its way to Google. */
function dayToIso(value: string): string {
  return new Date(`${value.slice(0, 10)}T12:00`).toISOString();
}

/**
 * An appointment in the Agenda do Time, which is Google Agenda: saving writes
 * to Google, and nobody is e-mailed (people are a tag). A private event is shown
 * read-only — it can only be seen and changed in Google itself.
 */
export function AgendaEventEditor({ calendars, clients, members, initial, defaultDate, onClose, onSaved }: AgendaEventEditorProps): JSX.Element {
  useEscapeToClose(onClose);
  const isEditing = Boolean(initial);
  const readOnly = Boolean(initial?.private);

  const [title, setTitle] = useState(initial?.title ?? '');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [allDay, setAllDay] = useState(initial?.allDay ?? false);
  const [start, setStart] = useState(() =>
    initial ? (initial.allDay ? `${initial.start.slice(0, 10)}T09:00` : toLocalInputValue(new Date(initial.start))) : toLocalInputValue(defaultDate ?? new Date()),
  );
  const [end, setEnd] = useState(() => (initial ? (initial.allDay ? lastDayOf(initial) : initial.end ? toLocalInputValue(new Date(initial.end)) : '') : ''));
  const [calendarKey, setCalendarKey] = useState(initial?.calendarKey ?? calendars[0]?.key ?? '');
  const [clientId, setClientId] = useState(initial?.clientId ?? '');
  // People are a tag on the event (for the Membro filter), never an e-mail invitation.
  const [memberIds, setMemberIds] = useState<Set<string>>(() => new Set(initial?.memberIds ?? []));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggleMember = (userId: string) => {
    setMemberIds((current) => {
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
      start: allDay ? dayToIso(start) : new Date(start).toISOString(),
      end: end ? (allDay ? dayToIso(end) : new Date(end).toISOString()) : undefined,
      allDay,
      clientId: clientId || null,
      memberIds: [...memberIds],
    };

    try {
      const response = isEditing
        ? await fetch(`/api/agenda/events/${initial!.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
        : await fetch('/api/agenda/events', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...payload, calendarKey }) });
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
    setError(null);
    try {
      const response = await fetch(`/api/agenda/events/${initial.id}`, { method: 'DELETE' });
      if (response.ok) onSaved();
      else setError(((await response.json().catch(() => ({}))) as { error?: string }).error ?? `HTTP ${response.status}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="eve-modal-backdrop" onClick={onClose}>
      <form className="eve-modal" onClick={(event) => event.stopPropagation()} onSubmit={(event) => void submit(event)}>
        <h2 className="eve-card__title">{readOnly ? 'Evento particular' : isEditing ? 'Editar evento' : 'Novo evento'}</h2>

        {error && <p className="eve-alert eve-alert--error">{error}</p>}
        {readOnly && <p className="eve-dim">Está marcado como particular no Google Agenda: aqui aparece só como “Ocupado”.</p>}
        {initial?.recurring && !readOnly && <p className="eve-setup__hint">Evento que se repete: a mudança vale só para esta data.</p>}

        {!readOnly && (
          <label className="eve-field">
            <span className="eve-field__label">Título</span>
            <input className="eve-input" value={title} onChange={(event) => setTitle(event.target.value)} required autoFocus={!isEditing} />
          </label>
        )}

        {!isEditing && calendars.length > 1 && (
          <label className="eve-field">
            <span className="eve-field__label">Agenda</span>
            <select className="eve-input" value={calendarKey} onChange={(event) => setCalendarKey(event.target.value)}>
              {calendars.map((calendar) => (
                <option key={calendar.key} value={calendar.key}>
                  {calendar.name}
                  {calendar.accountEmail && calendar.accountEmail !== calendar.name ? ` (${calendar.accountEmail})` : ''}
                </option>
              ))}
            </select>
          </label>
        )}
        {isEditing && <p className="eve-dim">Agenda: {initial!.calendarName}</p>}

        <label className="eve-check">
          <input type="checkbox" checked={allDay} onChange={(event) => setAllDay(event.target.checked)} disabled={readOnly} />
          <span>Dia inteiro</span>
        </label>

        <label className="eve-field">
          <span className="eve-field__label">Início</span>
          <input
            className="eve-input"
            type={allDay ? 'date' : 'datetime-local'}
            value={allDay ? start.slice(0, 10) : start}
            onChange={(event) => setStart(allDay ? `${event.target.value}T09:00` : event.target.value)}
            disabled={readOnly}
            required
          />
        </label>

        <label className="eve-field">
          <span className="eve-field__label">{allDay ? 'Último dia (opcional)' : 'Fim (opcional — sem fim, dura 1 hora)'}</span>
          <input
            className="eve-input"
            type={allDay ? 'date' : 'datetime-local'}
            value={allDay ? end.slice(0, 10) : end}
            onChange={(event) => setEnd(event.target.value ? (allDay ? `${event.target.value}T09:00` : event.target.value) : '')}
            disabled={readOnly}
          />
        </label>

        {!readOnly && (
          <>
            <label className="eve-field">
              <span className="eve-field__label">Cliente</span>
              <select className="eve-input" value={clientId} onChange={(event) => setClientId(event.target.value)}>
                <option value="">Nenhum</option>
                {clients.map((client) => (
                  <option key={client.id} value={client.id}>
                    {client.label}
                  </option>
                ))}
              </select>
              {initial?.clientId && !initial.clientTagged && <span className="eve-setup__hint">Reconhecido pelo nome no título. Salvar grava a tag no evento.</span>}
            </label>

            <div className="eve-field">
              <span className="eve-field__label">Pessoas (só uma marcação no Eve Hub — ninguém recebe e-mail)</span>
              <div className="eve-agenda-editor__attendees">
                {members.map((member) => (
                  <label key={member.id} className="eve-check">
                    <input type="checkbox" checked={memberIds.has(member.id)} onChange={() => toggleMember(member.id)} />
                    <span>{memberLabel(member)}</span>
                  </label>
                ))}
              </div>
            </div>

            <label className="eve-field">
              <span className="eve-field__label">Descrição</span>
              <textarea className="eve-input eve-notes__textarea" rows={3} value={description} onChange={(event) => setDescription(event.target.value)} />
            </label>
          </>
        )}

        <div className="eve-profile__actions">
          {!readOnly && (
            <button type="submit" className="eve-btn eve-btn--primary" disabled={busy || (!isEditing && !calendarKey)}>
              {isEditing ? 'Salvar' : 'Criar evento'}
            </button>
          )}
          {isEditing && !readOnly && (
            <ConfirmButton confirmLabel="Excluir mesmo" disabled={busy} onConfirm={() => void remove()}>
              Excluir
            </ConfirmButton>
          )}
          {initial?.link && (
            <a className="eve-btn" href={initial.link} target="_blank" rel="noreferrer">
              Abrir no Google Agenda
            </a>
          )}
          <button type="button" className="eve-btn" onClick={onClose} disabled={busy}>
            Fechar
          </button>
        </div>
      </form>
    </div>
  );
}
