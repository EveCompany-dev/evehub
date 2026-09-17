'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState, type JSX } from 'react';
import { AgendaEventEditor } from './AgendaEventEditor';
import type { AgendaEventSummary } from './agenda-types';
import { hexToRgba } from './job-types';
import { memberLabel, type JobMember } from './job-types';
import { MonthGrid } from './MonthGrid';
import type { ClientOption } from './scheduling-types';

export interface AgendaWorkspaceProps {
  currentUserId: string;
  /** "Minha Agenda" from the nav dropdown — preset to only this user's own events. */
  initialMemberFilter?: string;
}

type EditorState = { mode: 'new'; date?: Date } | { mode: 'edit'; event: AgendaEventSummary } | null;

function isoDateOnly(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function timeOnly(iso: string): string {
  return new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

/**
 * The actual agenda — a Notion-style calendar of events (meetings,
 * deadlines, whatever), independent of the Instagram/Facebook post
 * scheduler. The scheduler is a *tool* someone reaches from here (the link
 * below), not the agenda itself — see SchedulingCalendar/PostEditor for
 * that.
 */
export function AgendaWorkspace({ currentUserId, initialMemberFilter }: AgendaWorkspaceProps): JSX.Element {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth());

  const [clients, setClients] = useState<ClientOption[]>([]);
  const [members, setMembers] = useState<JobMember[]>([]);
  const [events, setEvents] = useState<AgendaEventSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [filterMember, setFilterMember] = useState(initialMemberFilter ?? '');
  const [filterClient, setFilterClient] = useState('');
  const [editor, setEditor] = useState<EditorState>(null);

  const loadClients = useCallback(async () => {
    try {
      const response = await fetch('/api/scheduling/clients', { cache: 'no-store' });
      if (response.ok) setClients(((await response.json()) as { clients: ClientOption[] }).clients);
    } catch {
      // Non-critical: client filter/picker just won't have options.
    }
  }, []);

  const loadMembers = useCallback(async () => {
    try {
      const response = await fetch('/api/workspace/members', { cache: 'no-store' });
      if (response.ok) setMembers(((await response.json()) as { members: JobMember[] }).members);
    } catch {
      // Non-critical: member filter/picker just won't have options.
    }
  }, []);

  const loadEvents = useCallback(async () => {
    setLoading(true);
    try {
      const from = new Date(year, month, 1);
      const to = new Date(year, month + 1, 0, 23, 59, 59);
      const params = new URLSearchParams({ from: from.toISOString(), to: to.toISOString() });
      if (filterMember) params.set('member', filterMember);
      if (filterClient) params.set('client', filterClient);

      const response = await fetch(`/api/agenda/events?${params.toString()}`, { cache: 'no-store' });
      if (!response.ok) {
        setError(`HTTP ${response.status}`);
        return;
      }
      const body = (await response.json()) as { events: AgendaEventSummary[] };
      setEvents(body.events);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  }, [year, month, filterMember, filterClient]);

  useEffect(() => {
    // Mount fetch — same legitimate case as useWidgetData.ts's initial fetch.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadClients();
    void loadMembers();
  }, [loadClients, loadMembers]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadEvents();
  }, [loadEvents]);

  const eventsByDay = new Map<string, AgendaEventSummary[]>();
  for (const item of events) {
    const key = isoDateOnly(new Date(item.startAt));
    eventsByDay.set(key, [...(eventsByDay.get(key) ?? []), item]);
  }

  return (
    <div className="eve-scheduling">
      <div className="eve-scheduling__filters eve-card">
        <label className="eve-field eve-scheduling__filter">
          <span className="eve-field__label">Membro</span>
          <select className="eve-input" value={filterMember} onChange={(event) => setFilterMember(event.target.value)}>
            <option value="">Todos</option>
            {members.map((member) => (
              <option key={member.id} value={member.id}>
                {memberLabel(member)}
              </option>
            ))}
          </select>
        </label>

        <label className="eve-field eve-scheduling__filter">
          <span className="eve-field__label">Cliente</span>
          <select className="eve-input" value={filterClient} onChange={(event) => setFilterClient(event.target.value)}>
            <option value="">Todos</option>
            {clients.map((client) => (
              <option key={client.id} value={client.id}>
                {client.label}
              </option>
            ))}
          </select>
        </label>

        <Link href="/scheduling?new=1" className="eve-btn eve-scheduling__new-btn" title="Agendar um post do Instagram/Facebook">
          Agendar post (Meta) →
        </Link>

        <button type="button" className="eve-btn eve-btn--primary eve-scheduling__new-btn" onClick={() => setEditor({ mode: 'new' })}>
          + Novo evento
        </button>
      </div>

      {error && <p className="eve-alert eve-alert--error">{error}</p>}
      {loading && <p className="eve-dim">carregando...</p>}

      <MonthGrid
        year={year}
        month={month}
        onMonthChange={(nextYear, nextMonth) => {
          setYear(nextYear);
          setMonth(nextMonth);
        }}
        onDayClick={(date) => setEditor({ mode: 'new', date })}
        renderDay={(date) => (
          <div className="eve-month__chips">
            {(eventsByDay.get(isoDateOnly(date)) ?? []).map((item) => (
              <button
                key={item.id}
                type="button"
                className="eve-agenda-chip"
                style={item.color ? { backgroundColor: hexToRgba(item.color, 0.18), borderColor: item.color } : undefined}
                onClick={(event) => {
                  event.stopPropagation();
                  setEditor({ mode: 'edit', event: item });
                }}
                title={item.description ?? item.title}
              >
                {!item.allDay && <span className="eve-agenda-chip__time">{timeOnly(item.startAt)}</span>}
                <span className="eve-agenda-chip__label">{item.title}</span>
              </button>
            ))}
          </div>
        )}
      />

      {editor && (
        <AgendaEventEditor
          clients={clients}
          members={members}
          currentUserId={currentUserId}
          initial={editor.mode === 'edit' ? editor.event : null}
          defaultDate={editor.mode === 'new' ? editor.date : undefined}
          onClose={() => setEditor(null)}
          onSaved={() => {
            setEditor(null);
            void loadEvents();
          }}
        />
      )}
    </div>
  );
}
