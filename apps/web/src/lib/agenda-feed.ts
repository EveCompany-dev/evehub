import type { AgendaEventSummary } from '../components/agenda-types';
import type { ScheduledPostRow } from '../components/scheduling-types';

/**
 * The Agenda do Time: every event and every scheduled post of the team on one
 * calendar, narrowed by tag filters (cliente, membro, tipo). Pure, so the
 * filter rules are testable without rendering the page.
 */

export type AgendaKind = 'event' | 'post';

interface AgendaItemBase {
  id: string;
  /** ISO start: the event's startAt, the post's scheduledFor. */
  at: string;
  clientId: string | null;
  /** Who it belongs to: an event's attendees plus whoever created it; a post's author. */
  memberIds: string[];
}

export type AgendaItem = (AgendaItemBase & { kind: 'event'; event: AgendaEventSummary }) | (AgendaItemBase & { kind: 'post'; post: ScheduledPostRow });

export interface AgendaFilters {
  clients: string[];
  members: string[];
  kinds: AgendaKind[];
}

export const NO_AGENDA_FILTERS: AgendaFilters = { clients: [], members: [], kinds: [] };

export function toAgendaItems(events: readonly AgendaEventSummary[], posts: readonly ScheduledPostRow[]): AgendaItem[] {
  const items: AgendaItem[] = [
    ...events.map(
      (event): AgendaItem => ({
        kind: 'event',
        id: event.id,
        at: event.startAt,
        clientId: event.clientId,
        memberIds: [...new Set([event.createdBy, ...event.attendees.map((attendee) => attendee.user.id)])],
        event,
      }),
    ),
    ...posts.map(
      (post): AgendaItem => ({ kind: 'post', id: post.id, at: post.scheduledFor, clientId: post.clientId, memberIds: [post.createdBy], post }),
    ),
  ];
  return items.sort((a, b) => a.at.localeCompare(b.at));
}

export function hasAgendaFilters(filters: AgendaFilters): boolean {
  return filters.clients.length > 0 || filters.members.length > 0 || filters.kinds.length > 0;
}

/** Tags of one filter are alternatives (this client OR that one); different filters must all hold. */
export function filterAgenda(items: readonly AgendaItem[], filters: AgendaFilters): AgendaItem[] {
  return items.filter(
    (item) =>
      (filters.kinds.length === 0 || filters.kinds.includes(item.kind)) &&
      (filters.clients.length === 0 || (item.clientId !== null && filters.clients.includes(item.clientId))) &&
      (filters.members.length === 0 || item.memberIds.some((id) => filters.members.includes(id))),
  );
}
