import type { CalendarEventData, CalendarEventInput, CalendarWriteResult } from '@eve/connector-sdk';
import { loadConnectorContext, prisma, runSync, type Prisma } from '@eve/core';
import { z } from 'zod';
import type { AgendaCalendar, AgendaEventSummary } from '../components/agenda-types';
import { dedupeEvents, inferClientId } from './agenda-feed';
import { calendarConnectorIds } from './nav-access';
import { HttpError } from './session';

/**
 * Server half of the Agenda do Time. Google is the source of truth: events
 * are read from the connector's mirrored records (refreshed when stale),
 * and every change is written to Google first, then mirrored back.
 */

/** Opening the agenda re-reads a calendar that hasn't synced this recently. */
const STALE_MS = 2 * 60 * 1000;

type CalendarInstance = Awaited<ReturnType<typeof calendarInstances>>[number];

export function calendarKey(instanceId: string, calendarId: string): string {
  return `${instanceId}|${calendarId}`;
}

function parseCalendarKey(key: string): { instanceId: string; calendarId: string } {
  const at = key.indexOf('|');
  if (at < 0) throw new HttpError(400, 'Agenda inválida.');
  return { instanceId: key.slice(0, at), calendarId: key.slice(at + 1) };
}

/** The workspace's calendar connections, the oldest first (the team calendar is normally connected first). */
export async function calendarInstances(workspaceId: string) {
  return prisma.connectorInstance.findMany({
    where: { workspaceId, connectorId: { in: calendarConnectorIds() }, status: { not: 'disabled' } },
    orderBy: { createdAt: 'asc' },
  });
}

/**
 * Re-syncs whatever is stale, in parallel; a failed sync leaves the last good
 * copy and its error on the connection. Returns whether it synced anything —
 * the rows passed in are then out of date (a new latest snapshot, for one).
 */
export async function refreshStale(instances: CalendarInstance[]): Promise<boolean> {
  const now = Date.now();
  const stale = instances.filter((instance) => !instance.lastSyncedAt || now - instance.lastSyncedAt.getTime() > STALE_MS);
  await Promise.all(stale.map((instance) => runSync(instance.id).catch(() => undefined)));
  return stale.length > 0;
}

interface SnapshotShape {
  accountEmail?: string;
  calendars?: { id: string; name: string; color: string | null }[];
}

/** The calendars each connection syncs, from its latest snapshot. */
async function listCalendars(instances: CalendarInstance[]): Promise<AgendaCalendar[]> {
  const ids = instances.map((instance) => instance.latestSnapshotId).filter((id): id is string => Boolean(id));
  const snapshots = await prisma.syncSnapshot.findMany({ where: { id: { in: ids } }, select: { id: true, data: true } });
  return instances.flatMap((instance) => {
    const data = (snapshots.find((snapshot) => snapshot.id === instance.latestSnapshotId)?.data ?? {}) as SnapshotShape;
    const accountEmail = data.accountEmail ?? (instance.config as { accountEmail?: string } | null)?.accountEmail ?? '';
    return (data.calendars ?? []).map((calendar) => ({ key: calendarKey(instance.id, calendar.id), name: calendar.name, color: calendar.color, accountEmail }));
  });
}

/** A calendar connector's record data — CalendarEventData by contract (see @eve/connector-sdk). */
function eventData(record: { data: unknown }): CalendarEventData {
  return record.data as unknown as CalendarEventData;
}

interface Directory {
  clients: { id: string; name: string }[];
  membersByEmail: Map<string, string>;
  memberIds: Set<string>;
}

async function directory(workspaceId: string): Promise<Directory> {
  const [clients, members] = await Promise.all([
    prisma.client.findMany({ where: { workspaceId }, select: { id: true, name: true } }),
    prisma.user.findMany({ where: { workspaceId, deletedAt: null }, select: { id: true, email: true } }),
  ]);
  return { clients, membersByEmail: new Map(members.map((member) => [member.email.toLowerCase(), member.id])), memberIds: new Set(members.map((member) => member.id)) };
}

function toSummary(record: { id: string; connectorInstanceId: string; data: unknown }, dir: Directory): AgendaEventSummary {
  const data = eventData(record);
  const emails = data.attendees.map((attendee) => attendee.email);
  // Tagged from Eve Hub (older records may predate the field), plus anyone invited in Google with a team address.
  const byEmail = [...emails, ...(data.organizerEmail ? [data.organizerEmail] : [])].map((email) => dir.membersByEmail.get(email));
  const memberIds = [...new Set([...(data.memberIds ?? []).filter((id) => dir.memberIds.has(id)), ...byEmail.filter((id): id is string => Boolean(id))])];
  const tagged = data.clientId && dir.clients.some((client) => client.id === data.clientId) ? data.clientId : null;
  return {
    id: record.id,
    title: data.title,
    description: data.description,
    location: data.location,
    start: data.start,
    end: data.end,
    allDay: data.allDay,
    color: data.color,
    calendarKey: calendarKey(record.connectorInstanceId, data.calendarId),
    calendarName: data.calendarName,
    link: data.link,
    private: data.private,
    recurring: data.recurring,
    clientId: tagged ?? (data.private ? null : inferClientId(data.title, dir.clients)),
    clientTagged: Boolean(tagged),
    attendeeEmails: emails,
    memberIds,
  };
}

/** Every appointment overlapping [from, to], one copy per meeting, soonest first. */
export async function loadAgenda(workspaceId: string, from: Date, to: Date): Promise<{ connected: boolean; calendars: AgendaCalendar[]; events: AgendaEventSummary[] }> {
  const found = await calendarInstances(workspaceId);
  if (found.length === 0) return { connected: false, calendars: [], events: [] };
  const instances = (await refreshStale(found)) ? await calendarInstances(workspaceId) : found;

  const [calendars, records, dir] = await Promise.all([
    listCalendars(instances),
    prisma.syncRecord.findMany({ where: { connectorInstanceId: { in: instances.map((instance) => instance.id) } }, select: { id: true, connectorInstanceId: true, data: true } }),
    directory(workspaceId),
  ]);

  const order = new Map(instances.map((instance, index) => [instance.id, index]));
  const inRange = records
    .filter((record) => {
      const data = eventData(record);
      const start = new Date(data.start).getTime();
      const end = data.end ? new Date(data.end).getTime() : start;
      return start <= to.getTime() && end >= from.getTime();
    })
    .sort((a, b) => (order.get(a.connectorInstanceId) ?? 0) - (order.get(b.connectorInstanceId) ?? 0));

  const unique = dedupeEvents(inRange.map((record) => ({ record, uid: eventData(record).uid, start: eventData(record).start })));
  const events = unique.map(({ record }) => toSummary(record, dir)).sort((a, b) => a.start.localeCompare(b.start));
  return { connected: true, calendars, events };
}

/** What the event form sends, for creating and editing alike. */
export const agendaEventSchema = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().max(4000).optional(),
  start: z.string().datetime(),
  end: z.string().datetime().optional(),
  allDay: z.boolean().default(false),
  clientId: z.string().min(1).nullable().optional(),
  /** Team members tagged on it — a tag stored on the event; nobody is invited or e-mailed. */
  memberIds: z.array(z.string().min(1)).max(50).default([]),
});

export type AgendaEventBody = z.infer<typeof agendaEventSchema>;

async function checkMembers(workspaceId: string, ids: string[]): Promise<string[]> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return [];
  const count = await prisma.user.count({ where: { workspaceId, id: { in: unique }, deletedAt: null } });
  if (count !== unique.length) throw new HttpError(400, 'Uma ou mais pessoas não pertencem a este workspace.');
  return unique;
}

async function checkClient(workspaceId: string, clientId: string | null | undefined): Promise<string | null> {
  if (!clientId) return null;
  const client = await prisma.client.findFirst({ where: { id: clientId, workspaceId }, select: { id: true } });
  if (!client) throw new HttpError(400, 'Cliente inválido.');
  return client.id;
}

function calendarOf(instance: CalendarInstance) {
  const { connector, ctx } = loadConnectorContext(instance);
  if (!connector.calendar) throw new HttpError(400, 'Essa conexão não é uma agenda.');
  return { calendar: connector.calendar, ctx };
}

async function saveRecord(instanceId: string, result: CalendarWriteResult): Promise<{ id: string; connectorInstanceId: string; data: unknown }> {
  if (!result.ok) {
    if (result.conflict) throw new HttpError(409, 'Alguém mudou esse evento no Google Agenda nesse meio-tempo. Reabra a agenda e tente de novo.');
    throw new HttpError(502, result.error);
  }
  const { record } = result;
  const data = record.data as Prisma.InputJsonValue;
  return prisma.syncRecord.upsert({
    where: { connectorInstanceId_remoteId: { connectorInstanceId: instanceId, remoteId: record.remoteId } },
    create: { connectorInstanceId: instanceId, remoteId: record.remoteId, remoteVersion: record.remoteVersion, data },
    update: { remoteVersion: record.remoteVersion, data, syncedAt: new Date() },
    select: { id: true, connectorInstanceId: true, data: true },
  });
}

/** Creates the appointment in Google (which sends the invitations) and mirrors it. */
export async function createAgendaEvent(workspaceId: string, key: string, body: AgendaEventBody): Promise<AgendaEventSummary> {
  const { instanceId, calendarId } = parseCalendarKey(key);
  const instance = (await calendarInstances(workspaceId)).find((candidate) => candidate.id === instanceId);
  if (!instance) throw new HttpError(404, 'Essa agenda não está mais conectada.');

  const input: CalendarEventInput = {
    calendarId,
    title: body.title,
    description: body.description ?? null,
    start: body.start,
    end: body.end ?? null,
    allDay: body.allDay,
    memberIds: await checkMembers(workspaceId, body.memberIds),
    clientId: await checkClient(workspaceId, body.clientId),
  };
  const { calendar, ctx } = calendarOf(instance);
  return toSummary(await saveRecord(instance.id, await calendar.createEvent(ctx, input)), await directory(workspaceId));
}

async function requireEventRecord(workspaceId: string, id: string) {
  const record = await prisma.syncRecord.findUnique({ where: { id }, include: { connectorInstance: true } });
  if (!record || record.connectorInstance.workspaceId !== workspaceId || !calendarConnectorIds().includes(record.connectorInstance.connectorId)) {
    throw new HttpError(404, 'Esse evento não existe mais na agenda.');
  }
  const data = eventData(record);
  if (data.private) throw new HttpError(403, 'É um evento particular: só dá para mexer nele no próprio Google Agenda.');
  return { record, data };
}

/**
 * Edits it in Google, only if nobody changed it there first (the version is
 * checked). The event's guests are never touched, and nobody is e-mailed.
 */
export async function updateAgendaEvent(workspaceId: string, id: string, body: AgendaEventBody): Promise<{ before: string; event: AgendaEventSummary }> {
  const { record, data } = await requireEventRecord(workspaceId, id);
  const dir = await directory(workspaceId);
  const input: CalendarEventInput = {
    calendarId: data.calendarId,
    title: body.title,
    description: body.description ?? null,
    start: body.start,
    end: body.end ?? null,
    allDay: body.allDay,
    memberIds: await checkMembers(workspaceId, body.memberIds),
    clientId: await checkClient(workspaceId, body.clientId),
  };
  const { calendar, ctx } = calendarOf(record.connectorInstance);
  const saved = await saveRecord(record.connectorInstanceId, await calendar.updateEvent(ctx, record.remoteId, input, record.remoteVersion));
  return { before: data.title, event: toSummary(saved, dir) };
}

/** Deletes it in Google (quietly — no cancellation e-mail) and from the mirror. */
export async function deleteAgendaEvent(workspaceId: string, id: string): Promise<{ title: string }> {
  const { record, data } = await requireEventRecord(workspaceId, id);
  const { calendar, ctx } = calendarOf(record.connectorInstance);
  const result = await calendar.deleteEvent(ctx, record.remoteId);
  if (!result.ok) throw new HttpError(502, result.error);
  await prisma.syncRecord.delete({ where: { id: record.id } });
  return { title: data.title };
}
