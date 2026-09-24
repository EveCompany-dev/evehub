import type { AgendaEventSummary } from '../components/agenda-types';
import { fold } from './fold';

/**
 * The Agenda do Time's pure rules: which days an appointment sits on, the tag
 * filters (cliente, membro, agenda), telling the same meeting apart when two
 * connected calendars both have it, and spotting a client in a title. Pure,
 * so they're testable without Google or a page.
 */

export interface AgendaFilters {
  clients: string[];
  members: string[];
  calendars: string[];
}

export const NO_AGENDA_FILTERS: AgendaFilters = { clients: [], members: [], calendars: [] };

export function hasAgendaFilters(filters: AgendaFilters): boolean {
  return filters.clients.length > 0 || filters.members.length > 0 || filters.calendars.length > 0;
}

/** Tags of one filter are alternatives (this client OR that one); different filters must all hold. */
export function filterAgenda(events: readonly AgendaEventSummary[], filters: AgendaFilters): AgendaEventSummary[] {
  return events.filter(
    (event) =>
      (filters.calendars.length === 0 || filters.calendars.includes(event.calendarKey)) &&
      (filters.clients.length === 0 || (event.clientId !== null && filters.clients.includes(event.clientId))) &&
      (filters.members.length === 0 || event.memberIds.some((id) => filters.members.includes(id))),
  );
}

function localDay(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

/** A multi-day all-day event stops being repeated after this many days (a month-long "Férias" stays readable). */
const MAX_SPAN_DAYS = 31;

/**
 * The calendar days ("YYYY-MM-DD") an appointment shows on: a timed one on
 * its start day (in the viewer's time zone), an all-day one on every day it
 * covers — read from its own dates, never shifted by a time zone.
 */
export function eventDays(event: Pick<AgendaEventSummary, 'start' | 'end' | 'allDay'>): string[] {
  if (!event.allDay) return [localDay(new Date(event.start))];
  const first = event.start.slice(0, 10);
  const endExclusive = event.end ? event.end.slice(0, 10) : null;
  const days: string[] = [];
  const cursor = new Date(`${first}T00:00:00.000Z`);
  do {
    days.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  } while (endExclusive && cursor.toISOString().slice(0, 10) < endExclusive && days.length < MAX_SPAN_DAYS);
  return days;
}

/**
 * One meeting on two connected calendars (marketing@ invited Felicia, and
 * both are connected) is the same Google event: same uid, same start. Keeps
 * the first copy — callers pass the team calendar's first.
 */
export function dedupeEvents<T extends { uid: string | null; start: string }>(events: readonly T[]): T[] {
  const seen = new Set<string>();
  return events.filter((event) => {
    if (!event.uid) return true;
    const key = `${event.uid}|${event.start}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * The client an appointment is about when nobody tagged one: the client whose
 * whole name appears in the title ("Gravação Acme Café" → Acme Café). The
 * longest name wins, so "Acme Café" beats "Acme". Names under three letters
 * never match — they'd hit every other word.
 */
export function inferClientId(title: string, clients: readonly { id: string; name: string }[]): string | null {
  const haystack = ` ${fold(title).replace(/[^\p{L}\p{N}]+/gu, ' ')} `;
  let best: { id: string; length: number } | null = null;
  for (const client of clients) {
    const needle = fold(client.name).replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
    if (needle.length < 3) continue;
    if (haystack.includes(` ${needle} `) && (!best || needle.length > best.length)) best = { id: client.id, length: needle.length };
  }
  return best?.id ?? null;
}
