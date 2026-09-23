/**
 * Minimal Google Calendar REST client — `fetch` only, no googleapis SDK
 * (it is huge, and this connector needs six endpoints).
 */
import { GOOGLE_CALENDAR_API, type GoogleCalendarListEntry, type GoogleEvent } from './shared';

const OAUTH_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const TIMEOUT_MS = 20_000;
/** Refresh a little early: a token that expires mid-request is a failed sync. */
const EXPIRY_MARGIN_MS = 60_000;
/** A calendar with a decade of daily recurrences can't stall the worker. */
const MAX_PAGES = 10;

export class GoogleCalendarError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'GoogleCalendarError';
  }
}

export interface GoogleCalendarAuth {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
}

/** Access tokens last an hour and the worker syncs every few minutes — see google-ads's same cache. */
const tokenCache = new Map<string, { token: string; expiresAt: number }>();

export function resetTokenCacheForTests(): void {
  tokenCache.clear();
}

async function withTimeout(url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') throw new GoogleCalendarError('O Google Agenda não respondeu a tempo.', 504);
    throw new GoogleCalendarError(error instanceof Error ? error.message : String(error), 0);
  } finally {
    clearTimeout(timer);
  }
}

export async function getAccessToken(auth: GoogleCalendarAuth, now: number = Date.now()): Promise<string> {
  const cached = tokenCache.get(auth.refreshToken);
  if (cached && cached.expiresAt > now) return cached.token;

  const response = await withTimeout(OAUTH_TOKEN_URL, {
    method: 'POST',
    body: new URLSearchParams({ client_id: auth.clientId, client_secret: auth.clientSecret, refresh_token: auth.refreshToken, grant_type: 'refresh_token' }),
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  });
  const parsed = (await response.json().catch(() => ({}))) as { access_token?: string; expires_in?: number; error?: string; error_description?: string };

  if (!response.ok || !parsed.access_token) {
    // invalid_grant: access revoked in the Google account, the password
    // changed, or (for an app still in "testing") the 7-day token expired.
    throw new GoogleCalendarError(
      parsed.error === 'invalid_grant'
        ? 'O acesso ao Google Agenda foi revogado ou expirou. Reconecte a conta em Conectores.'
        : (parsed.error_description ?? parsed.error ?? `O Google recusou a renovação do acesso (HTTP ${response.status}).`),
      response.status,
    );
  }

  tokenCache.set(auth.refreshToken, { token: parsed.access_token, expiresAt: now + (parsed.expires_in ?? 3600) * 1000 - EXPIRY_MARGIN_MS });
  return parsed.access_token;
}

/** One line somebody can act on, from the API's error status. */
export function describeError(status: number, message: string | undefined): string {
  if (status === 401) return 'O Google recusou o acesso. Reconecte a conta em Conectores.';
  if (status === 403) return `Sem permissão nessa agenda do Google${message ? `: ${message}` : '.'}`;
  if (status === 404) return 'Essa agenda ou esse evento não existe mais no Google Agenda.';
  if (status === 429) return 'O Google Agenda pediu para ir mais devagar. A próxima sincronização tenta de novo.';
  return message ?? `O Google Agenda respondeu HTTP ${status}.`;
}

async function request<T>(token: string, path: string, init: { method?: string; params?: Record<string, string>; body?: unknown; ifMatch?: string } = {}): Promise<T> {
  const url = new URL(`${GOOGLE_CALENDAR_API}${path}`);
  for (const [key, value] of Object.entries(init.params ?? {})) url.searchParams.set(key, value);

  const response = await withTimeout(url.toString(), {
    method: init.method ?? 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      ...(init.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(init.ifMatch ? { 'If-Match': init.ifMatch } : {}),
    },
    ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
  });

  if (response.status === 204) return undefined as T;
  const parsed = (await response.json().catch(() => ({}))) as T & { error?: { message?: string } };
  if (!response.ok) throw new GoogleCalendarError(describeError(response.status, parsed.error?.message), response.status);
  return parsed;
}

export async function listCalendarEntries(token: string): Promise<GoogleCalendarListEntry[]> {
  const entries: GoogleCalendarListEntry[] = [];
  let pageToken: string | undefined;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const response = await request<{ items?: GoogleCalendarListEntry[]; nextPageToken?: string }>(token, '/users/me/calendarList', {
      params: { maxResults: '250', ...(pageToken ? { pageToken } : {}) },
    });
    entries.push(...(response.items ?? []));
    pageToken = response.nextPageToken;
    if (!pageToken) break;
  }
  return entries;
}

export async function getCalendarEntry(token: string, calendarId: string): Promise<GoogleCalendarListEntry> {
  return request<GoogleCalendarListEntry>(token, `/users/me/calendarList/${encodeURIComponent(calendarId)}`);
}

/** Every event in the window, recurring ones expanded into their occurrences. */
export async function listEvents(token: string, calendarId: string, timeMin: Date, timeMax: Date): Promise<GoogleEvent[]> {
  const events: GoogleEvent[] = [];
  let pageToken: string | undefined;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const response = await request<{ items?: GoogleEvent[]; nextPageToken?: string }>(token, `/calendars/${encodeURIComponent(calendarId)}/events`, {
      params: {
        singleEvents: 'true',
        orderBy: 'startTime',
        timeMin: timeMin.toISOString(),
        timeMax: timeMax.toISOString(),
        maxResults: '2500',
        ...(pageToken ? { pageToken } : {}),
      },
    });
    events.push(...(response.items ?? []));
    pageToken = response.nextPageToken;
    if (!pageToken) break;
  }
  return events;
}

/** `sendUpdates=all`: the people invited get Google's own invitation / change / cancellation e-mail. */
const NOTIFY = { sendUpdates: 'all' };

export async function insertEvent(token: string, calendarId: string, body: Record<string, unknown>): Promise<GoogleEvent> {
  return request<GoogleEvent>(token, `/calendars/${encodeURIComponent(calendarId)}/events`, { method: 'POST', params: NOTIFY, body });
}

/** Sent with If-Match: an edit made in Google meanwhile answers 412 instead of being overwritten. */
export async function patchEvent(token: string, calendarId: string, eventId: string, body: Record<string, unknown>, etag: string): Promise<GoogleEvent> {
  return request<GoogleEvent>(token, `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`, {
    method: 'PATCH',
    params: NOTIFY,
    body,
    ifMatch: etag,
  });
}

export async function deleteEvent(token: string, calendarId: string, eventId: string): Promise<void> {
  try {
    await request<void>(token, `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`, { method: 'DELETE', params: NOTIFY });
  } catch (error) {
    // Already gone in Google: exactly what was asked for.
    if (error instanceof GoogleCalendarError && (error.status === 404 || error.status === 410)) return;
    throw error;
  }
}
