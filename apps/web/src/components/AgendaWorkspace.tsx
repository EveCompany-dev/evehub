'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState, type JSX } from 'react';
import { filterAgenda, hasAgendaFilters, NO_AGENDA_FILTERS, toAgendaItems, type AgendaFilters, type AgendaItem, type AgendaKind } from '../lib/agenda-feed';
import { AgendaEventEditor } from './AgendaEventEditor';
import type { AgendaEventSummary } from './agenda-types';
import type { Choice } from './ChoicePopover';
import type { TableClient } from './data-table-types';
import { hexToRgba, memberLabel, type JobMember } from './job-types';
import { MediaThumb } from './MediaThumb';
import { MonthGrid } from './MonthGrid';
import { PlatformIcon } from './PlatformIcon';
import { POST_STATUS_LABEL, POST_TYPE_LABEL, type ClientOption, type ScheduledPostRow } from './scheduling-types';
import { TagFilter } from './TagFilter';
import { ClientPill, TagPill } from './TagPill';

export interface AgendaWorkspaceProps {
  currentUserId: string;
}

type EditorState = { mode: 'new'; date?: Date } | { mode: 'edit'; event: AgendaEventSummary } | null;

/** What /api/scheduling/clients returns: the picker's option plus the brand, for the pills. */
type ClientRow = ClientOption & { color?: string | null; icon?: string | null; logoUrl?: string | null };

const KIND_CHOICES: Choice[] = [
  { id: 'event', label: 'Eventos', node: <TagPill name="Eventos" color="blue" /> },
  { id: 'post', label: 'Posts', node: <TagPill name="Posts" color="pink" /> },
];

function isoDateOnly(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function timeOnly(iso: string): string {
  return new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

/**
 * The Agenda do Time — the agenda's only view. Everyone's events (meetings,
 * deadlines) and every scheduled Instagram/Facebook post on one month grid,
 * narrowed with tag filters (cliente, membro, tipo) in the same pills the
 * tables use. A post opens in Agendar Post (/scheduling?post=…), which is
 * where posts are written and edited; events open in their editor here.
 */
export function AgendaWorkspace({ currentUserId }: AgendaWorkspaceProps): JSX.Element {
  const router = useRouter();
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth());

  const [clients, setClients] = useState<ClientRow[]>([]);
  const [members, setMembers] = useState<JobMember[]>([]);
  const [events, setEvents] = useState<AgendaEventSummary[]>([]);
  const [posts, setPosts] = useState<ScheduledPostRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [filters, setFilters] = useState<AgendaFilters>(NO_AGENDA_FILTERS);
  const [editor, setEditor] = useState<EditorState>(null);

  const loadClients = useCallback(async () => {
    try {
      const response = await fetch('/api/scheduling/clients', { cache: 'no-store' });
      if (response.ok) setClients(((await response.json()) as { clients: ClientRow[] }).clients);
    } catch {
      // Non-critical: the client filter/picker just won't have options.
    }
  }, []);

  const loadMembers = useCallback(async () => {
    try {
      const response = await fetch('/api/workspace/members', { cache: 'no-store' });
      if (response.ok) setMembers(((await response.json()) as { members: JobMember[] }).members);
    } catch {
      // Non-critical: the member filter/picker just won't have options.
    }
  }, []);

  // The whole month, unfiltered: the tag filters run here, so switching them never waits on the network.
  const loadMonth = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        from: new Date(year, month, 1).toISOString(),
        to: new Date(year, month + 1, 0, 23, 59, 59).toISOString(),
      }).toString();
      const [eventsResponse, postsResponse] = await Promise.all([
        fetch(`/api/agenda/events?${params}`, { cache: 'no-store' }),
        fetch(`/api/scheduling/posts?${params}`, { cache: 'no-store' }),
      ]);
      if (!eventsResponse.ok || !postsResponse.ok) {
        setError(`HTTP ${eventsResponse.ok ? postsResponse.status : eventsResponse.status}`);
        return;
      }
      setEvents(((await eventsResponse.json()) as { events: AgendaEventSummary[] }).events);
      setPosts(((await postsResponse.json()) as { posts: ScheduledPostRow[] }).posts);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  }, [year, month]);

  useEffect(() => {
    // Mount fetch — same legitimate case as useWidgetData.ts's initial fetch.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadClients();
    void loadMembers();
  }, [loadClients, loadMembers]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadMonth();
  }, [loadMonth]);

  const clientById = useMemo(
    () =>
      Object.fromEntries(
        clients.map((client): [string, TableClient] => [
          client.id,
          { id: client.id, label: client.label, color: client.color ?? null, icon: client.icon ?? null, logoUrl: client.logoUrl ?? null },
        ]),
      ),
    [clients],
  );

  const clientChoices = useMemo<Choice[]>(
    () => Object.values(clientById).map((client) => ({ id: client.id, label: client.label, node: <ClientPill client={client} /> })),
    [clientById],
  );

  const memberChoices = useMemo<Choice[]>(
    () => members.map((member) => ({ id: member.id, label: memberLabel(member), node: <TagPill name={memberLabel(member)} /> })),
    [members],
  );

  const itemsByDay = useMemo(() => {
    const map = new Map<string, AgendaItem[]>();
    for (const item of filterAgenda(toAgendaItems(events, posts), filters)) {
      const key = isoDateOnly(new Date(item.at));
      map.set(key, [...(map.get(key) ?? []), item]);
    }
    return map;
  }, [events, posts, filters]);

  const renderItem = (item: AgendaItem) => {
    if (item.kind === 'event') {
      const event = item.event;
      return (
        <button
          key={`event-${event.id}`}
          type="button"
          className="eve-agenda-chip"
          style={event.color ? { backgroundColor: hexToRgba(event.color, 0.18), borderColor: event.color } : undefined}
          onClick={(click) => {
            click.stopPropagation();
            setEditor({ mode: 'edit', event });
          }}
          title={event.description ?? event.title}
        >
          {!event.allDay && <span className="eve-agenda-chip__time">{timeOnly(event.startAt)}</span>}
          <span className="eve-agenda-chip__label">{event.title}</span>
        </button>
      );
    }

    const post = item.post;
    return (
      <button
        key={`post-${post.id}`}
        type="button"
        className={`eve-month__chip is-${post.status}`}
        onClick={(click) => {
          click.stopPropagation();
          router.push(`/scheduling?post=${post.id}`);
        }}
        title={
          post.status === 'failed' && post.statusMessage
            ? `${POST_STATUS_LABEL[post.status]}: ${post.statusMessage}`
            : `${timeOnly(post.scheduledFor)} · ${POST_STATUS_LABEL[post.status]} — ${post.caption}`
        }
      >
        {post.mediaUrl && <MediaThumb url={post.mediaUrl} className="eve-month__chip-thumb" />}
        <PlatformIcon platform={post.platform} size={13} />
        <span className="eve-month__chip-time">{timeOnly(post.scheduledFor)}</span>
        <span className="eve-month__chip-label">
          {post.clientLabel}
          {post.postType === 'feed' ? '' : ` · ${POST_TYPE_LABEL[post.postType]}`}
        </span>
        {post.status === 'failed' && <span className="eve-month__chip-bang">!</span>}
      </button>
    );
  };

  return (
    <div className="eve-scheduling">
      <div className="eve-agenda__bar">
        <TagFilter label="Cliente" choices={clientChoices} selected={filters.clients} onChange={(clientIds) => setFilters({ ...filters, clients: clientIds })} />
        <TagFilter label="Membro" choices={memberChoices} selected={filters.members} onChange={(memberIds) => setFilters({ ...filters, members: memberIds })} />
        <TagFilter
          label="Tipo"
          choices={KIND_CHOICES}
          selected={filters.kinds}
          onChange={(kinds) => setFilters({ ...filters, kinds: kinds as AgendaKind[] })}
        />
        {hasAgendaFilters(filters) && (
          <button type="button" className="eve-btn" onClick={() => setFilters(NO_AGENDA_FILTERS)}>
            Limpar filtros
          </button>
        )}
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
        renderDay={(date) => <div className="eve-month__chips">{(itemsByDay.get(isoDateOnly(date)) ?? []).map(renderItem)}</div>}
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
            void loadMonth();
          }}
        />
      )}
    </div>
  );
}
