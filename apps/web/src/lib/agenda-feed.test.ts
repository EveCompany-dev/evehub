import { describe, expect, it } from 'vitest';
import type { AgendaEventSummary } from '../components/agenda-types';
import { dedupeEvents, eventDays, filterAgenda, hasAgendaFilters, inferClientId, NO_AGENDA_FILTERS } from './agenda-feed';

function event(id: string, overrides: Partial<AgendaEventSummary> = {}): AgendaEventSummary {
  return {
    id,
    title: id,
    description: null,
    location: null,
    start: '2026-09-24T13:00:00.000Z',
    end: null,
    allDay: false,
    color: null,
    calendarKey: 'i1|marketing',
    calendarName: 'Marketing',
    link: null,
    private: false,
    recurring: false,
    clientId: null,
    clientTagged: false,
    attendeeEmails: [],
    memberIds: [],
    ...overrides,
  };
}

const events = [
  event('reuniao', { clientId: 'acme', memberIds: ['ana', 'caio'] }),
  event('gravacao', { clientId: 'beta', memberIds: ['bia'], calendarKey: 'i2|felicia' }),
  event('planejamento', { memberIds: ['ana'] }),
];

describe('filterAgenda', () => {
  const ids = (filters: Parameters<typeof filterAgenda>[1]) => filterAgenda(events, filters).map((item) => item.id);

  it('shows everyone’s appointments when no tag is picked', () => {
    expect(ids(NO_AGENDA_FILTERS)).toHaveLength(3);
    expect(hasAgendaFilters(NO_AGENDA_FILTERS)).toBe(false);
  });

  it('treats tags of one filter as alternatives and requires every filter that has one', () => {
    expect(ids({ ...NO_AGENDA_FILTERS, clients: ['acme', 'beta'] })).toEqual(['reuniao', 'gravacao']);
    expect(ids({ ...NO_AGENDA_FILTERS, members: ['ana'] })).toEqual(['reuniao', 'planejamento']);
    expect(ids({ clients: ['acme'], members: ['bia'], calendars: [] })).toEqual([]);
    expect(ids({ ...NO_AGENDA_FILTERS, calendars: ['i2|felicia'] })).toEqual(['gravacao']);
    expect(hasAgendaFilters({ ...NO_AGENDA_FILTERS, calendars: ['x'] })).toBe(true);
  });
});

describe('eventDays', () => {
  it('puts an all-day event on each day it covers, by its own dates', () => {
    expect(eventDays({ start: '2026-09-24T00:00:00.000Z', end: '2026-09-27T00:00:00.000Z', allDay: true })).toEqual(['2026-09-24', '2026-09-25', '2026-09-26']);
    expect(eventDays({ start: '2026-09-24T00:00:00.000Z', end: null, allDay: true })).toEqual(['2026-09-24']);
  });

  it('never repeats one for more than a month', () => {
    expect(eventDays({ start: '2026-01-01T00:00:00.000Z', end: '2026-12-31T00:00:00.000Z', allDay: true })).toHaveLength(31);
  });

  it('puts a timed event on its start day', () => {
    const start = new Date(2026, 8, 24, 10, 0).toISOString();
    expect(eventDays({ start, end: null, allDay: false })).toEqual(['2026-09-24']);
  });
});

describe('dedupeEvents', () => {
  it('keeps one copy of a meeting two connected calendars both have, but every occurrence of a series', () => {
    const copies = [
      { id: 'team', uid: 'abc@google.com', start: '2026-09-24T13:00:00.000Z' },
      { id: 'felicia', uid: 'abc@google.com', start: '2026-09-24T13:00:00.000Z' },
      { id: 'next-week', uid: 'abc@google.com', start: '2026-10-01T13:00:00.000Z' },
      { id: 'no-uid', uid: null, start: '2026-09-24T13:00:00.000Z' },
    ];
    expect(dedupeEvents(copies).map((item) => item.id)).toEqual(['team', 'next-week', 'no-uid']);
  });
});

describe('inferClientId', () => {
  const clients = [
    { id: 'acme', name: 'Acme' },
    { id: 'acme-cafe', name: 'Acme Café' },
    { id: 'tv', name: 'TV' },
  ];

  it('finds a client named in the title, accents and case aside, the longest name winning', () => {
    expect(inferClientId('Gravação ACME cafe — estúdio', clients)).toBe('acme-cafe');
    expect(inferClientId('Reunião com a Acme', clients)).toBe('acme');
  });

  it('matches whole names only, and never a very short one', () => {
    expect(inferClientId('Acmeville anual', clients)).toBeNull();
    expect(inferClientId('Gravação para TV', clients)).toBeNull();
  });
});
