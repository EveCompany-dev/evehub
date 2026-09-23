'use client';

import { useCallback, useEffect, useMemo, useState, type JSX } from 'react';
import { eventDays, filterAgenda, hasAgendaFilters, NO_AGENDA_FILTERS, type AgendaFilters } from '../lib/agenda-feed';
import { AgendaEventEditor } from './AgendaEventEditor';
import type { AgendaCalendar, AgendaEventSummary } from './agenda-types';
import type { Choice } from './ChoicePopover';
import type { TableClient } from './data-table-types';
import { hexToRgba, memberLabel, type JobMember } from './job-types';
import { MonthGrid } from './MonthGrid';
import type { ClientOption } from './scheduling-types';
import { TagFilter } from './TagFilter';
import { ClientPill, TagPill } from './TagPill';

type EditorState = { mode: 'new'; date?: Date } | { mode: 'edit'; event: AgendaEventSummary } | null;

/** What /api/scheduling/clients returns: the picker's option plus the brand, for the pills. */
type ClientRow = ClientOption & { color?: string | null; icon?: string | null; logoUrl?: string | null };

function isoDateOnly(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function timeOnly(iso: string): string {
  return new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

/**
 * The Agenda do Time: the team's appointments straight from the connected
 * Google Agenda (marketing@, plus anyone's own calendar that was connected),
 * on one month grid, narrowed with tag filters — cliente, membro and, with
 * more than one calendar, agenda. Creating, editing or deleting here writes
 * to Google; Google sends the invitations.
 */
export function AgendaWorkspace(): JSX.Element {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth());

  const [clients, setClients] = useState<ClientRow[]>([]);
  const [members, setMembers] = useState<JobMember[]>([]);
  const [calendars, setCalendars] = useState<AgendaCalendar[]>([]);
  const [events, setEvents] = useState<AgendaEventSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [filters, setFilters] = useState<AgendaFilters>(NO_AGENDA_FILTERS);
  const [editor, setEditor] = useState<EditorState>(null);

  useEffect(() => {
    // Mount fetch — every setState happens after an await (same case as useWidgetData.ts).
    void (async () => {
      try {
        const [clientsResponse, membersResponse] = await Promise.all([
          fetch('/api/scheduling/clients', { cache: 'no-store' }),
          fetch('/api/workspace/members', { cache: 'no-store' }),
        ]);
        if (clientsResponse.ok) setClients(((await clientsResponse.json()) as { clients: ClientRow[] }).clients);
        if (membersResponse.ok) setMembers(((await membersResponse.json()) as { members: JobMember[] }).members);
      } catch {
        // Non-critical: the filters and the form just have fewer options.
      }
    })();
  }, []);

  // The month's appointments, unfiltered: the tag filters run here, so switching them never waits on Google.
  const loadMonth = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        from: new Date(year, month, 1).toISOString(),
        to: new Date(year, month + 1, 0, 23, 59, 59).toISOString(),
      });
      const response = await fetch(`/api/agenda/events?${params.toString()}`, { cache: 'no-store' });
      const body = (await response.json().catch(() => ({}))) as { calendars?: AgendaCalendar[]; events?: AgendaEventSummary[]; error?: string };
      if (!response.ok) {
        setError(body.error ?? `HTTP ${response.status}`);
        return;
      }
      setCalendars(body.calendars ?? []);
      setEvents(body.events ?? []);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  }, [year, month]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadMonth();
  }, [loadMonth]);

  const clientChoices = useMemo<Choice[]>(
    () =>
      clients.map((client) => {
        const pill: TableClient = { id: client.id, label: client.label, color: client.color ?? null, icon: client.icon ?? null, logoUrl: client.logoUrl ?? null };
        return { id: client.id, label: client.label, node: <ClientPill client={pill} /> };
      }),
    [clients],
  );

  const memberChoices = useMemo<Choice[]>(
    () => members.map((member) => ({ id: member.id, label: memberLabel(member), node: <TagPill name={memberLabel(member)} /> })),
    [members],
  );

  const calendarChoices = useMemo<Choice[]>(
    () => calendars.map((calendar) => ({ id: calendar.key, label: calendar.name, node: <TagPill name={calendar.name} /> })),
    [calendars],
  );

  const eventsByDay = useMemo(() => {
    const map = new Map<string, AgendaEventSummary[]>();
    for (const item of filterAgenda(events, filters)) {
      for (const day of eventDays(item)) map.set(day, [...(map.get(day) ?? []), item]);
    }
    return map;
  }, [events, filters]);

  return (
    <div className="eve-scheduling">
      <div className="eve-agenda__bar">
        <TagFilter label="Cliente" choices={clientChoices} selected={filters.clients} onChange={(ids) => setFilters({ ...filters, clients: ids })} />
        <TagFilter label="Membro" choices={memberChoices} selected={filters.members} onChange={(ids) => setFilters({ ...filters, members: ids })} />
        {calendars.length > 1 && <TagFilter label="Agenda" choices={calendarChoices} selected={filters.calendars} onChange={(ids) => setFilters({ ...filters, calendars: ids })} />}
        {hasAgendaFilters(filters) && (
          <button type="button" className="eve-btn" onClick={() => setFilters(NO_AGENDA_FILTERS)}>
            Limpar filtros
          </button>
        )}
        <button type="button" className="eve-btn eve-btn--primary eve-scheduling__new-btn" disabled={calendars.length === 0} onClick={() => setEditor({ mode: 'new' })}>
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
        onDayClick={(date) => calendars.length > 0 && setEditor({ mode: 'new', date: new Date(date.getFullYear(), date.getMonth(), date.getDate(), 9, 0) })}
        renderDay={(date) => (
          <div className="eve-month__chips">
            {(eventsByDay.get(isoDateOnly(date)) ?? []).map((item) => (
              <button
                key={item.id}
                type="button"
                className={item.private ? 'eve-agenda-chip is-private' : 'eve-agenda-chip'}
                style={item.color ? { backgroundColor: hexToRgba(item.color, 0.22), borderColor: item.color } : undefined}
                onClick={(event) => {
                  event.stopPropagation();
                  setEditor({ mode: 'edit', event: item });
                }}
                title={[item.title, item.location, item.description].filter(Boolean).join(' — ')}
              >
                {!item.allDay && <span className="eve-agenda-chip__time">{timeOnly(item.start)}</span>}
                <span className="eve-agenda-chip__label">{item.title}</span>
              </button>
            ))}
          </div>
        )}
      />

      {editor && (
        <AgendaEventEditor
          calendars={calendars}
          clients={clients}
          members={members}
          initial={editor.mode === 'edit' ? editor.event : null}
          defaultDate={editor.mode === 'new' ? editor.date : undefined}
          onClose={() => setEditor(null)}
          onSaved={() => {
            setEditor(null);
            void loadMonth();
          }}
        />
      )}
    </div>
  );
}
