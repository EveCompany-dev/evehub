import 'dotenv/config';
import { encryptJson, prisma } from '@eve/core';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

/**
 * The Agenda do Time's routes against the real Postgres with a real (encrypted)
 * Google Agenda connection — only Google's HTTP is faked, and the session.
 * Skips itself when no database answers, like the other *.db.test.ts files.
 */

const session = vi.hoisted(() => ({
  user: null as null | { id: string; email: string; name: string | null; image: string | null; isOwner: boolean; roleTabs: string[] | null; workspaceId: string },
}));

vi.mock('./session', () => {
  class HttpError extends Error {
    constructor(
      readonly status: number,
      message: string,
    ) {
      super(message);
      this.name = 'HttpError';
    }
  }
  const requireUser = async () => {
    if (!session.user) throw new HttpError(401, 'unauthenticated');
    return session.user;
  };
  return { HttpError, requireUser, getSessionUser: async () => session.user };
});

async function databaseUp(): Promise<boolean> {
  try {
    await prisma.$queryRaw`SELECT 1`;
    await prisma.$queryRaw`SELECT "contentRowId" FROM "ScheduledPost" LIMIT 1`;
    return true;
  } catch {
    return false;
  }
}

const dbUp = await databaseUp();
const eventsRoute = await import('../app/api/agenda/events/route');
const eventRoute = await import('../app/api/agenda/events/[id]/route');

const CALENDAR = 'marketing-vitest@evecompany.com.br';
const FOTO = 'foto-video-vitest@group.calendar.google.com';
const params = (id: string) => ({ params: Promise.resolve({ id }) });
const json = (method: string, url: string, body: unknown) =>
  new Request(`http://test${url}`, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

/** What the fake Google holds, and every call it got. */
const google = {
  events: [] as Record<string, unknown>[],
  fotoEvents: [{ id: 'f1', etag: '"f1"', status: 'confirmed', summary: 'Reels e Fotos Babymee', start: { dateTime: '2026-09-11T09:00:00-03:00' } }] as Record<string, unknown>[],
  patchStatus: 200,
  calls: [] as { method: string; path: string; body: Record<string, unknown> | null }[],
};

function fakeGoogle(): void {
  vi.stubGlobal('fetch', async (input: string, init: RequestInit = {}) => {
    const url = new URL(input);
    const method = init.method ?? 'GET';
    const body = typeof init.body === 'string' ? (JSON.parse(init.body) as Record<string, unknown>) : null;
    google.calls.push({ method, path: url.pathname, body });
    const reply = (status: number, payload?: unknown) => new Response(status === 204 ? null : JSON.stringify(payload ?? {}), { status });

    if (url.hostname === 'oauth2.googleapis.com') return reply(200, { access_token: 'token', expires_in: 3600 });
    if (url.pathname.endsWith('/users/me/calendarList')) return reply(200, { items: [{ id: CALENDAR, summaryOverride: 'Marketing', backgroundColor: '#9fc6e7', primary: true, selected: true }, { id: FOTO, summary: 'Foto e Vídeo', backgroundColor: '#51b749', selected: true }, { id: 'antiga', summary: 'Desmarcada', selected: false }] });
    if (url.pathname.includes('/users/me/calendarList/')) return reply(200, { id: CALENDAR, summaryOverride: 'Marketing', backgroundColor: '#9fc6e7' });
    if (url.pathname.endsWith('/events') && method === 'GET') return reply(200, { items: url.pathname.includes(encodeURIComponent(FOTO)) ? google.fotoEvents : url.pathname.includes('antiga') ? [{ id: 'nunca', etag: '"x"', summary: 'Não deveria aparecer', start: { dateTime: '2026-09-24T10:00:00-03:00' } }] : google.events });
    if (url.pathname.endsWith('/events') && method === 'POST') {
      return reply(200, { id: 'novo', etag: '"n1"', status: 'confirmed', iCalUID: 'novo@google.com', ...body });
    }
    if (method === 'PATCH') return google.patchStatus === 200 ? reply(200, { id: 'e1', etag: '"e1b"', status: 'confirmed', ...body }) : reply(google.patchStatus, { error: { message: 'Precondition Failed' } });
    if (method === 'DELETE') return reply(204);
    return reply(404, { error: { message: `fake: ${method} ${url.pathname}` } });
  });
}

describe.skipIf(!dbUp)('Agenda do Time against Postgres, with Google faked', () => {
  let workspaceId = '';
  let memberId = '';
  let memberEmail = '';
  let clientId = '';

  beforeAll(async () => {
    const workspace = await prisma.workspace.create({ data: { name: `vitest-agenda-${Date.now()}` } });
    workspaceId = workspace.id;
    memberEmail = `ana-agenda-${Date.now()}@example.com`;
    const owner = await prisma.user.create({ data: { workspaceId, email: `owner-agenda-${Date.now()}@example.com`, name: 'Admin', isOwner: true } });
    const member = await prisma.user.create({ data: { workspaceId, email: memberEmail, name: 'Ana' } });
    memberId = member.id;
    clientId = (await prisma.client.create({ data: { workspaceId, name: 'Acme Café' } })).id;
    session.user = { id: owner.id, email: owner.email, name: 'Admin', image: null, isOwner: true, roleTabs: null, workspaceId };

    google.events = [
      {
        id: 'e1',
        etag: '"e1"',
        status: 'confirmed',
        summary: 'Gravação Acme Café',
        start: { dateTime: '2026-09-24T10:00:00-03:00' },
        end: { dateTime: '2026-09-24T12:00:00-03:00' },
        attendees: [{ email: memberEmail.toUpperCase(), responseStatus: 'accepted' }, { email: 'cliente@acme.com' }],
        iCalUID: 'e1@google.com',
      },
      { id: 'e2', etag: '"e2"', status: 'confirmed', summary: 'Consulta', visibility: 'private', start: { date: '2026-09-25' }, end: { date: '2026-09-26' } },
      { id: 'e3', etag: '"e3"', status: 'confirmed', summary: 'Mês que vem', start: { dateTime: '2026-11-10T10:00:00-03:00' } },
    ];
    fakeGoogle();
  });

  afterAll(async () => {
    vi.unstubAllGlobals();
    if (workspaceId) await prisma.workspace.delete({ where: { id: workspaceId } }).catch(() => undefined);
  });

  const range = '?from=2026-09-01T03:00:00.000Z&to=2026-10-01T02:59:59.000Z';
  const getMonth = async () => (await (await eventsRoute.GET(new Request(`http://test/api/agenda/events${range}`))).json()) as {
    connected: boolean;
    calendars: { key: string; name: string }[];
    events: { id: string; title: string; clientId: string | null; clientTagged: boolean; memberIds: string[]; private: boolean; attendeeEmails: string[] }[];
  };

  it('says nothing is connected before a Google Agenda is', async () => {
    expect(await getMonth()).toEqual({ connected: false, calendars: [], events: [] });
  });

  it('syncs on first read and shows the month, a private event only as busy', async () => {
    const encrypted = encryptJson({ clientId: 'client-id-longo', clientSecret: 'secret', refreshToken: 'refresh-token-longo' });
    await prisma.connectorInstance.create({
      data: {
        workspaceId,
        connectorId: 'google-calendar',
        label: 'Google Agenda · marketing',
        config: { accountEmail: CALENDAR, calendarIds: ['*'] },
        credentialsEnc: new Uint8Array(encrypted.data),
        credentialsKeyVersion: encrypted.keyVersion,
      },
    });

    const month = await getMonth();
    expect(month.connected).toBe(true);
    // Every calendar ticked in Google is read (not the unticked one), each becoming a filter tag.
    expect(month.calendars.map((calendar) => calendar.name)).toEqual(['Marketing', 'Foto e Vídeo']);
    expect(month.events.map((event) => event.title)).toEqual(['Reels e Fotos Babymee', 'Gravação Acme Café', 'Ocupado']);
    // The client comes from the title, the member from the invite (case aside).
    expect(month.events.find((event) => event.title === 'Gravação Acme Café')).toMatchObject({ clientId, clientTagged: false, memberIds: [memberId] });
    expect(month.events.find((event) => event.private)).toMatchObject({ private: true, clientId: null });
  });

  it('creates in Google tagging the client and the people (no invitation), and shows it right away', async () => {
    const [calendar] = (await getMonth()).calendars;
    const response = await eventsRoute.POST(
      json('POST', '/api/agenda/events', { calendarKey: calendar!.key, title: 'Reunião Acme', start: '2026-09-28T13:00:00.000Z', allDay: false, clientId, memberIds: [memberId] }),
    );
    expect(response.status).toBe(201);
    const { event } = (await response.json()) as { event: { id: string; clientTagged: boolean; memberIds: string[] } };
    expect(event).toMatchObject({ clientTagged: true, memberIds: [memberId] });

    const insert = google.calls.find((call) => call.method === 'POST' && call.path.endsWith('/events'))!;
    expect(insert.body).not.toHaveProperty('attendees');
    expect(insert.body).toMatchObject({ extendedProperties: { shared: { eveClientId: clientId, eveMemberIds: memberId } } });
    expect(await prisma.syncRecord.count({ where: { id: event.id } })).toBe(1);
  });

  it('never touches the guests when editing, and refuses to overwrite a change made in Google', async () => {
    const { events } = await getMonth();
    const gravacao = events.find((event) => event.title === 'Gravação Acme Café')!;

    const saved = await eventRoute.PATCH(json('PATCH', '', { title: 'Gravação Acme Café', start: '2026-09-24T13:00:00.000Z', allDay: false, memberIds: [] }), params(gravacao.id));
    expect(saved.status).toBe(200);
    const patchCall = google.calls.filter((call) => call.method === 'PATCH').at(-1)!;
    expect(patchCall.body).not.toHaveProperty('attendees');

    google.patchStatus = 412;
    const conflict = await eventRoute.PATCH(json('PATCH', '', { title: 'Outro', start: '2026-09-24T13:00:00.000Z', allDay: false, memberIds: [] }), params(gravacao.id));
    expect(conflict.status).toBe(409);
    google.patchStatus = 200;
  });

  it('never edits a private event from here', async () => {
    const { events } = await getMonth();
    const busy = events.find((event) => event.private)!;
    expect((await eventRoute.PATCH(json('PATCH', '', { title: 'x', start: '2026-09-25T12:00:00.000Z', allDay: true, memberIds: [] }), params(busy.id))).status).toBe(403);
    expect((await eventRoute.DELETE(new Request('http://test'), params(busy.id))).status).toBe(403);
  });

  it('deletes in Google and from the mirror', async () => {
    const { events } = await getMonth();
    const reuniao = events.find((event) => event.title === 'Reunião Acme')!;
    expect((await eventRoute.DELETE(new Request('http://test'), params(reuniao.id))).status).toBe(200);
    expect(await prisma.syncRecord.count({ where: { id: reuniao.id } })).toBe(0);
    expect(google.calls.some((call) => call.method === 'DELETE' && call.path.endsWith('/events/novo'))).toBe(true);
  });

  it('keeps the agenda to people who can see the Agenda tab', async () => {
    session.user = { ...session.user!, isOwner: false, roleTabs: ['chat'] };
    expect((await eventsRoute.GET(new Request(`http://test/api/agenda/events${range}`))).status).toBe(403);
  });
});
