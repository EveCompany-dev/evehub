import type { ConnectorContext } from '@eve/connector-sdk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetTokenCacheForTests } from './calendar-client';
import { googleCalendarConnector, pickCalendars, type GoogleCalendarConfig, type GoogleCalendarCredentials } from './connector';

// Only the network is faked: the paging, mapping and conflict handling under test are the connector's own.
const credentials: GoogleCalendarCredentials = { clientId: 'client-id-longo', clientSecret: 'secret', refreshToken: 'refresh-token-longo' };

function context(config: Partial<GoogleCalendarConfig> = {}): ConnectorContext<GoogleCalendarConfig, GoogleCalendarCredentials> {
  return { instanceId: 'i1', config: { accountEmail: 'marketing@evecompany.com.br', calendarIds: ['*'], ...config }, credentials, lastSyncedAt: null };
}

const primary = { id: 'marketing@evecompany.com.br', summary: 'marketing@evecompany.com.br', summaryOverride: 'Marketing', backgroundColor: '#9fc6e7', primary: true };
const event = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  etag: `"${id}"`,
  status: 'confirmed',
  summary: `Evento ${id}`,
  start: { dateTime: '2026-09-24T10:00:00-03:00' },
  end: { dateTime: '2026-09-24T11:00:00-03:00' },
  ...extra,
});

type Handler = (url: URL, init: RequestInit) => { status?: number; body?: unknown };
let handler: Handler;
const calls: { method: string; url: URL; init: RequestInit }[] = [];

beforeEach(() => {
  resetTokenCacheForTests();
  calls.length = 0;
  vi.stubGlobal('fetch', async (input: string, init: RequestInit = {}) => {
    const url = new URL(input);
    calls.push({ method: init.method ?? 'GET', url, init });
    if (url.hostname === 'oauth2.googleapis.com') return new Response(JSON.stringify({ access_token: 'token', expires_in: 3600 }), { status: 200 });
    const { status = 200, body } = handler(url, init);
    return new Response(status === 204 ? null : JSON.stringify(body ?? {}), { status });
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('sync', () => {
  it('mirrors every event of the chosen calendar, across pages, as versioned records', async () => {
    handler = (url) => {
      if (url.pathname.endsWith('/calendarList')) return { body: { items: [primary, { id: 'feriados', summary: 'Feriados', selected: false }] } };
      if (!url.searchParams.get('pageToken')) return { body: { items: [event('a'), event('b', { status: 'cancelled' })], nextPageToken: 'p2' } };
      return { body: { items: [event('c')] } };
    };

    const result = await googleCalendarConnector.sync(context());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.records!.map((record) => [record.remoteId, record.remoteVersion])).toEqual([
      ['marketing@evecompany.com.br::a', '"a"'],
      ['marketing@evecompany.com.br::c', '"c"'],
    ]);
    expect(result.records![0]!.data).toMatchObject({ title: 'Evento a', calendarName: 'Marketing', start: '2026-09-24T13:00:00.000Z' });
    expect(result.data).toEqual({ accountEmail: 'marketing@evecompany.com.br', calendars: [{ id: primary.id, name: 'Marketing', color: '#9fc6e7' }] });
    // Only the chosen calendar is read, with recurrences expanded.
    const eventCalls = calls.filter((call) => call.url.pathname.includes('/events'));
    expect(eventCalls.every((call) => call.url.pathname.includes(encodeURIComponent(primary.id)) && call.url.searchParams.get('singleEvents') === 'true')).toBe(true);
  });

  it('says so in words when the access was revoked', async () => {
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ error: 'invalid_grant' }), { status: 400 }));
    const result = await googleCalendarConnector.sync(context());
    expect(result).toEqual({ ok: false, error: 'O acesso ao Google Agenda foi revogado ou expirou. Reconecte a conta em Equipe > Conectores.' });
  });
});

describe('pickCalendars', () => {
  const entries = [
    { id: 'atendimento@evecompany.com.br', primary: true, selected: true },
    { id: 'marketing', summary: 'Marketing Evecompany', selected: true },
    { id: 'foto', summary: 'Foto e Vídeo', selected: true },
    { id: 'desmarcada', summary: 'Antiga', selected: false },
    { id: 'escondida', summary: 'Escondida', selected: true, hidden: true },
  ];

  it('"*" takes every calendar ticked in Google, the main one included', () => {
    expect(pickCalendars(entries, ['*']).map((entry) => entry.id)).toEqual(['atendimento@evecompany.com.br', 'marketing', 'foto']);
  });

  it('still understands "primary" and explicit ids', () => {
    expect(pickCalendars(entries, ['primary']).map((entry) => entry.id)).toEqual(['atendimento@evecompany.com.br']);
    expect(pickCalendars(entries, ['foto', 'desmarcada']).map((entry) => entry.id)).toEqual(['foto', 'desmarcada']);
  });
});

describe('calendar', () => {
  const input = { calendarId: primary.id, title: 'Reunião Acme', description: null, start: '2026-09-24T13:00:00.000Z', end: null, allDay: false, memberIds: ['u1'], clientId: 'c1' };

  it('creates the event in Google without e-mailing anyone, and returns it as a record', async () => {
    handler = (url, init) => {
      if (url.pathname.includes('/calendarList/')) return { body: primary };
      return { body: event('novo', { summary: JSON.parse(String(init.body)).summary }) };
    };
    const result = await googleCalendarConnector.calendar!.createEvent(context(), input);
    expect(result).toMatchObject({ ok: true, record: { remoteId: `${primary.id}::novo`, data: { title: 'Reunião Acme' } } });
    const insert = calls.find((call) => call.method === 'POST' && call.url.pathname.endsWith('/events'))!;
    expect(insert.url.searchParams.get('sendUpdates')).toBe('none');
    const sent = JSON.parse(String(insert.init.body)) as Record<string, unknown>;
    expect(sent).not.toHaveProperty('attendees');
    expect(sent).toMatchObject({ extendedProperties: { shared: { eveClientId: 'c1', eveMemberIds: 'u1' } } });
  });

  it('edits with If-Match, and reports a conflict when Google changed it first', async () => {
    handler = (url) => (url.pathname.includes('/calendarList/') ? { body: primary } : { status: 412, body: { error: { message: 'Precondition Failed' } } });
    const result = await googleCalendarConnector.calendar!.updateEvent(context(), `${primary.id}::a`, input, '"a"');
    expect(result).toEqual({ ok: false, conflict: true });
    const patch = calls.find((call) => call.method === 'PATCH')!;
    expect((patch.init.headers as Record<string, string>)['If-Match']).toBe('"a"');
  });

  it('treats deleting an event already gone as done', async () => {
    handler = () => ({ status: 410, body: { error: { message: 'Resource has been deleted' } } });
    expect(await googleCalendarConnector.calendar!.deleteEvent(context(), `${primary.id}::a`)).toEqual({ ok: true });
  });
});
