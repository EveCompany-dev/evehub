import { describe, expect, it } from 'vitest';
import { parseRemoteId, toEventData, toGoogleEventBody, toRemoteId, type CalendarRef, type GoogleEvent } from './shared';

const calendar: CalendarRef = { id: 'marketing@evecompany.com.br', name: 'Marketing', color: '#9fc6e7' };

const base: GoogleEvent = {
  id: 'ev1',
  etag: '"1"',
  status: 'confirmed',
  summary: 'Gravação Acme',
  start: { dateTime: '2026-09-24T10:00:00-03:00' },
  end: { dateTime: '2026-09-24T12:00:00-03:00' },
  attendees: [
    { email: 'Felicia@EveCompany.com.br', displayName: 'Felicia', responseStatus: 'accepted' },
    { email: 'sala@resource.calendar.google.com', resource: true },
  ],
  organizer: { email: 'marketing@evecompany.com.br' },
  htmlLink: 'https://www.google.com/calendar/event?eid=abc',
  iCalUID: 'abc@google.com',
};

describe('toEventData', () => {
  it('keeps what the agenda shows, in UTC, without meeting rooms', () => {
    expect(toEventData(base, calendar)).toEqual({
      title: 'Gravação Acme',
      description: null,
      location: null,
      start: '2026-09-24T13:00:00.000Z',
      end: '2026-09-24T15:00:00.000Z',
      allDay: false,
      calendarId: 'marketing@evecompany.com.br',
      calendarName: 'Marketing',
      color: '#9fc6e7',
      attendees: [{ email: 'felicia@evecompany.com.br', name: 'Felicia', response: 'accepted' }],
      organizerEmail: 'marketing@evecompany.com.br',
      link: 'https://www.google.com/calendar/event?eid=abc',
      uid: 'abc@google.com',
      clientId: null,
      memberIds: [],
      private: false,
      recurring: false,
    });
  });

  it('reads an all-day event as its days, and the event color over the calendar one', () => {
    const data = toEventData({ ...base, start: { date: '2026-09-24' }, end: { date: '2026-09-26' }, colorId: '11' }, calendar)!;
    expect(data).toMatchObject({ allDay: true, start: '2026-09-24T00:00:00.000Z', end: '2026-09-26T00:00:00.000Z', color: '#dc2127' });
  });

  it('shows a private event only as busy', () => {
    const data = toEventData({ ...base, visibility: 'private', description: 'consulta médica', extendedProperties: { shared: { eveClientId: 'c1' } } }, calendar)!;
    expect(data).toMatchObject({ title: 'Ocupado', description: null, attendees: [], clientId: null, private: true });
  });

  it('reads the people tagged from Eve Hub', () => {
    expect(toEventData({ ...base, extendedProperties: { shared: { eveMemberIds: 'u1, u2' } } }, calendar)!.memberIds).toEqual(['u1', 'u2']);
  });

  it('reads the client tag Eve Hub wrote on the event', () => {
    expect(toEventData({ ...base, extendedProperties: { shared: { eveClientId: 'c1' } } }, calendar)!.clientId).toBe('c1');
    expect(toEventData({ ...base, extendedProperties: { shared: { eveClientId: '' } } }, calendar)!.clientId).toBeNull();
  });

  it('leaves out cancelled events, location markers and invites the account declined', () => {
    expect(toEventData({ ...base, status: 'cancelled' }, calendar)).toBeNull();
    expect(toEventData({ ...base, eventType: 'workingLocation' }, calendar)).toBeNull();
    expect(toEventData({ ...base, attendees: [{ email: 'marketing@evecompany.com.br', self: true, responseStatus: 'declined' }] }, calendar)).toBeNull();
  });
});

describe('toGoogleEventBody', () => {
  const input = { calendarId: 'primary', title: 'Reunião', description: null, start: '2026-09-24T13:00:00.000Z', end: null, allDay: false, memberIds: ['u1', 'u2', 'u1'], clientId: 'c1' };

  it('gives a timed event with no end one hour, in São Paulo time, tagging each person once and inviting nobody', () => {
    expect(toGoogleEventBody(input)).toEqual({
      summary: 'Reunião',
      description: '',
      start: { dateTime: '2026-09-24T13:00:00.000Z', timeZone: 'America/Sao_Paulo' },
      end: { dateTime: '2026-09-24T14:00:00.000Z', timeZone: 'America/Sao_Paulo' },
      extendedProperties: { shared: { eveClientId: 'c1', eveMemberIds: 'u1,u2' } },
    });
  });

  it('writes an all-day event as São Paulo dates, with the exclusive end Google wants', () => {
    // 01:30 UTC on the 25th is still the 24th in São Paulo.
    const body = toGoogleEventBody({ ...input, allDay: true, start: '2026-09-25T01:30:00.000Z', end: '2026-09-26T12:00:00.000Z' });
    expect(body.start).toEqual({ date: '2026-09-24' });
    expect(body.end).toEqual({ date: '2026-09-27' });
  });

  it('clears the tags by writing them empty (PATCH merges extended properties)', () => {
    expect(toGoogleEventBody({ ...input, clientId: null, memberIds: [] }).extendedProperties).toEqual({ shared: { eveClientId: '', eveMemberIds: '' } });
  });
});

describe('remote ids', () => {
  it('round-trips a calendar id that itself contains colons', () => {
    const id = toRemoteId('c_abc::weird@group.calendar.google.com', 'ev1_20260924');
    expect(parseRemoteId(id)).toEqual({ calendarId: 'c_abc::weird@group.calendar.google.com', eventId: 'ev1_20260924' });
  });
});
