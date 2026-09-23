/**
 * Everything about the Google Agenda connector that is pure data: no fetch,
 * no credentials. The OAuth routes, the widget bundle and the tests import
 * from here.
 */
import type { CalendarEventData, CalendarEventInput } from '@eve/connector-sdk';

export const GOOGLE_CALENDAR_API = 'https://www.googleapis.com/calendar/v3';

/**
 * What the connection asks Google for: read/write events on the account's
 * calendars, list those calendars, and the account's e-mail to name the
 * connection. Nothing about Gmail, Drive or contacts.
 */
export const GOOGLE_CALENDAR_SCOPES = [
  'openid',
  'email',
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/calendar.calendarlist.readonly',
] as const;

/** The team's time zone: new events are written in it, all-day dates are read in it. */
export const DEFAULT_TIME_ZONE = 'America/Sao_Paulo';

/** How far back and ahead a sync reads. Recurring events are expanded inside this window. */
export const SYNC_PAST_DAYS = 60;
export const SYNC_FUTURE_DAYS = 365;

/** Google's event palette (colorId → hex), from the Calendar API's /colors. */
export const EVENT_COLORS: Record<string, string> = {
  '1': '#a4bdfc',
  '2': '#7ae7bf',
  '3': '#dbadff',
  '4': '#ff887c',
  '5': '#fbd75b',
  '6': '#ffb878',
  '7': '#46d6db',
  '8': '#e1e1e1',
  '9': '#5484ed',
  '10': '#51b749',
  '11': '#dc2127',
};

/** What an event shows when Google marks it private: never its details. */
export const PRIVATE_TITLE = 'Ocupado';

/** The key Eve Hub stores its client tag under, on the event itself (visible to every copy of it). */
export const CLIENT_PROPERTY = 'eveClientId';

/** The team members tagged from Eve Hub, comma-separated user ids — a tag, not an invitation. */
export const MEMBERS_PROPERTY = 'eveMemberIds';

/**
 * `calendarIds: ['*']`: every calendar the account has ticked in Google
 * ("Marketing Evecompany", "Foto e Vídeo", "Reunião Cliente"…). Teams keep
 * their work in secondary calendars, which is what the Agenda filters by.
 */
export const ALL_SHOWN_CALENDARS = '*';

export interface GoogleEventTime {
  date?: string;
  dateTime?: string;
  timeZone?: string;
}

export interface GoogleEvent {
  id: string;
  etag: string;
  status?: string;
  summary?: string;
  description?: string;
  location?: string;
  start?: GoogleEventTime;
  end?: GoogleEventTime;
  attendees?: { email?: string; displayName?: string; responseStatus?: string; self?: boolean; resource?: boolean }[];
  organizer?: { email?: string };
  htmlLink?: string;
  iCalUID?: string;
  colorId?: string;
  visibility?: string;
  recurringEventId?: string;
  eventType?: string;
  extendedProperties?: { shared?: Record<string, string>; private?: Record<string, string> };
}

export interface GoogleCalendarListEntry {
  id: string;
  summary?: string;
  summaryOverride?: string;
  backgroundColor?: string;
  primary?: boolean;
  accessRole?: string;
  /** Ticked in the account's Google Agenda sidebar. */
  selected?: boolean;
  hidden?: boolean;
}

export interface CalendarRef {
  id: string;
  name: string;
  color: string | null;
}

/** What `sync()` stores verbatim as the snapshot. */
export interface GoogleCalendarSnapshot {
  accountEmail: string;
  /** The calendars being synced. */
  calendars: CalendarRef[];
}

/** A record id unique inside one connection: the same event id can exist in two of its calendars. */
export function toRemoteId(calendarId: string, eventId: string): string {
  return `${calendarId}::${eventId}`;
}

export function parseRemoteId(remoteId: string): { calendarId: string; eventId: string } {
  const at = remoteId.lastIndexOf('::');
  if (at < 0) throw new Error(`Id de evento inválido: ${remoteId}`);
  return { calendarId: remoteId.slice(0, at), eventId: remoteId.slice(at + 2) };
}

export function calendarRef(entry: GoogleCalendarListEntry): CalendarRef {
  return { id: entry.id, name: entry.summaryOverride ?? entry.summary ?? entry.id, color: entry.backgroundColor ?? null };
}

/** "2026-09-22" → the ISO instant of that day's midnight UTC — the convention CalendarEventData uses for all-day events. */
function dayToIso(date: string): string {
  return `${date}T00:00:00.000Z`;
}

/**
 * A Google event as the Agenda do Time reads it, or null for what doesn't
 * belong there: cancelled events, "working location" markers, and invites
 * this calendar's owner declined.
 */
export function toEventData(event: GoogleEvent, calendar: CalendarRef): CalendarEventData | null {
  if (event.status === 'cancelled' || event.eventType === 'workingLocation') return null;
  if (event.attendees?.some((attendee) => attendee.self && attendee.responseStatus === 'declined')) return null;

  const allDay = Boolean(event.start?.date && !event.start.dateTime);
  const start = allDay ? dayToIso(event.start!.date!) : event.start?.dateTime ? new Date(event.start.dateTime).toISOString() : null;
  if (!start) return null;
  const end = allDay ? (event.end?.date ? dayToIso(event.end.date) : null) : event.end?.dateTime ? new Date(event.end.dateTime).toISOString() : null;

  const hidden = event.visibility === 'private' || event.visibility === 'confidential';
  const clientId = event.extendedProperties?.shared?.[CLIENT_PROPERTY] || null;

  return {
    title: hidden ? PRIVATE_TITLE : event.summary?.trim() || '(sem título)',
    description: hidden ? null : (event.description ?? null),
    location: hidden ? null : (event.location ?? null),
    start,
    end,
    allDay,
    calendarId: calendar.id,
    calendarName: calendar.name,
    color: (event.colorId ? EVENT_COLORS[event.colorId] : undefined) ?? calendar.color,
    attendees: hidden
      ? []
      : (event.attendees ?? [])
          .filter((attendee) => attendee.email && !attendee.resource)
          .map((attendee) => ({ email: attendee.email!.toLowerCase(), name: attendee.displayName ?? null, response: attendee.responseStatus ?? null })),
    organizerEmail: event.organizer?.email?.toLowerCase() ?? null,
    link: event.htmlLink ?? null,
    uid: event.iCalUID ?? null,
    clientId: hidden ? null : clientId,
    memberIds: hidden
      ? []
      : (event.extendedProperties?.shared?.[MEMBERS_PROPERTY] ?? '')
          .split(',')
          .map((id) => id.trim())
          .filter(Boolean),
    private: hidden,
    recurring: Boolean(event.recurringEventId),
  };
}

/** The calendar date of `iso` in `timeZone`, "YYYY-MM-DD". */
function dateIn(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso));
}

function nextDay(date: string): string {
  const next = new Date(`${date}T00:00:00.000Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  return next.toISOString().slice(0, 10);
}

/**
 * The request body for creating or editing an event. An all-day event runs
 * from its start day through its end day (Google wants the day after, it is
 * exclusive); a timed one with no end lasts an hour, since Google needs one.
 */
export function toGoogleEventBody(input: CalendarEventInput, timeZone: string = DEFAULT_TIME_ZONE): Record<string, unknown> {
  let start: GoogleEventTime;
  let end: GoogleEventTime;
  if (input.allDay) {
    const first = dateIn(input.start, timeZone);
    const last = input.end ? dateIn(input.end, timeZone) : first;
    start = { date: first };
    end = { date: nextDay(last < first ? first : last) };
  } else {
    const startMs = new Date(input.start).getTime();
    const endMs = input.end && new Date(input.end).getTime() > startMs ? new Date(input.end).getTime() : startMs + 60 * 60 * 1000;
    start = { dateTime: new Date(startMs).toISOString(), timeZone };
    end = { dateTime: new Date(endMs).toISOString(), timeZone };
  }

  return {
    summary: input.title,
    description: input.description ?? '',
    start,
    end,
    // No `attendees`: Eve Hub never invites anyone (a PATCH leaves the guests
    // an event already has untouched). People are tags, like the client.
    // "" rather than dropping a key: a PATCH merges extendedProperties, so a
    // removed tag has to be written as empty to actually go away.
    extendedProperties: { shared: { [CLIENT_PROPERTY]: input.clientId ?? '', [MEMBERS_PROPERTY]: [...new Set(input.memberIds)].join(',') } },
  };
}
