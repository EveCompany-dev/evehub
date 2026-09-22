import { describe, expect, it } from 'vitest';
import type { AgendaEventSummary } from '../components/agenda-types';
import type { ScheduledPostRow } from '../components/scheduling-types';
import { filterAgenda, hasAgendaFilters, NO_AGENDA_FILTERS, toAgendaItems } from './agenda-feed';

function member(id: string) {
  return { id, name: id, email: `${id}@evecompany.com.br`, image: null };
}

function event(id: string, startAt: string, overrides: Partial<AgendaEventSummary> = {}): AgendaEventSummary {
  return {
    id,
    title: id,
    description: null,
    startAt,
    endAt: null,
    allDay: false,
    color: null,
    clientId: null,
    client: null,
    createdBy: 'ana',
    createdByUser: member('ana'),
    attendees: [],
    ...overrides,
  };
}

function post(id: string, scheduledFor: string, overrides: Partial<ScheduledPostRow> = {}): ScheduledPostRow {
  return {
    id,
    connectorInstanceId: 'meta',
    clientId: 'acme',
    clientLabel: 'Acme',
    platform: 'instagram',
    postType: 'feed',
    caption: '',
    mediaUrl: 'https://example.com/a.jpg',
    scheduledFor,
    status: 'scheduled',
    statusMessage: null,
    metaPostId: null,
    createdBy: 'bia',
    ...overrides,
  };
}

const items = toAgendaItems(
  [
    event('reuniao', '2026-09-10T13:00:00.000Z', { clientId: 'acme', attendees: [{ user: member('caio') }] }),
    event('prazo', '2026-09-02T09:00:00.000Z'),
  ],
  [post('reels', '2026-09-05T18:00:00.000Z'), post('story', '2026-09-20T12:00:00.000Z', { clientId: 'beta', createdBy: 'ana' })],
);

describe('toAgendaItems', () => {
  it('puts events and posts on one timeline, soonest first', () => {
    expect(items.map((item) => item.id)).toEqual(['prazo', 'reels', 'reuniao', 'story']);
  });

  it('counts an event for its creator and every attendee, and a post for its author', () => {
    expect(items.find((item) => item.id === 'reuniao')!.memberIds.sort()).toEqual(['ana', 'caio']);
    expect(items.find((item) => item.id === 'reels')!.memberIds).toEqual(['bia']);
  });
});

describe('filterAgenda', () => {
  const ids = (filters: Parameters<typeof filterAgenda>[1]) => filterAgenda(items, filters).map((item) => item.id);

  it('shows everyone’s stuff when no tag is picked', () => {
    expect(ids(NO_AGENDA_FILTERS)).toHaveLength(4);
    expect(hasAgendaFilters(NO_AGENDA_FILTERS)).toBe(false);
  });

  it('treats tags of one filter as alternatives', () => {
    expect(ids({ ...NO_AGENDA_FILTERS, clients: ['acme', 'beta'] })).toEqual(['reels', 'reuniao', 'story']);
    expect(ids({ ...NO_AGENDA_FILTERS, members: ['caio', 'bia'] })).toEqual(['reels', 'reuniao']);
  });

  it('requires every filter that has a tag', () => {
    expect(ids({ clients: ['acme'], members: ['ana'], kinds: [] })).toEqual(['reuniao']);
    expect(ids({ clients: ['acme'], members: [], kinds: ['post'] })).toEqual(['reels']);
    expect(hasAgendaFilters({ clients: ['acme'], members: [], kinds: [] })).toBe(true);
  });

  it('leaves out anything with no client once a client tag is picked', () => {
    expect(ids({ ...NO_AGENDA_FILTERS, clients: ['acme'] })).not.toContain('prazo');
  });

  it('filters by kind', () => {
    expect(ids({ ...NO_AGENDA_FILTERS, kinds: ['event'] })).toEqual(['prazo', 'reuniao']);
  });
});
