import type { CalendarWriteResult, EveConnector, FieldSchema, RemoteRecord, SyncResult } from '@eve/connector-sdk';
import { registerConnector } from '@eve/connector-sdk';
import { z } from 'zod';
import {
  deleteEvent,
  getAccessToken,
  getCalendarEntry,
  GoogleCalendarError,
  insertEvent,
  listCalendarEntries,
  listEvents,
  patchEvent,
} from './calendar-client';
import {
  calendarRef,
  parseRemoteId,
  SYNC_FUTURE_DAYS,
  SYNC_PAST_DAYS,
  toEventData,
  toGoogleEventBody,
  toRemoteId,
  type CalendarRef,
  type GoogleCalendarSnapshot,
  type GoogleEvent,
} from './shared';

const configSchema = z.object({
  /** The Google account this connection signed in as — what names it in Conectores. */
  accountEmail: z.string().default(''),
  /** Which of the account's calendars to show; "primary" is its main one. */
  calendarIds: z.array(z.string().min(1)).min(1).default(['primary']),
});

const credentialsSchema = z.object({
  clientId: z.string().min(10),
  clientSecret: z.string().min(5),
  refreshToken: z.string().min(10),
});

export type GoogleCalendarConfig = z.infer<typeof configSchema>;
export type GoogleCalendarCredentials = z.infer<typeof credentialsSchema>;

const DAY_MS = 24 * 60 * 60 * 1000;

function toRecord(event: GoogleEvent, calendar: CalendarRef): RemoteRecord | null {
  const data = toEventData(event, calendar);
  return data ? { remoteId: toRemoteId(calendar.id, event.id), remoteVersion: event.etag, data: data as unknown as Record<string, unknown> } : null;
}

function failure(error: unknown): { ok: false; error: string } {
  return { ok: false, error: error instanceof Error ? error.message : String(error) };
}

/**
 * One Google account's calendars in the Agenda do Time — the shared
 * marketing@ account everybody's computer is signed into, or anyone's own.
 * Connected through Google's consent screen (the web app's
 * /api/connectors/google-calendar routes), never by pasting a token.
 *
 * Google stays the source of truth: sync mirrors every event in a window
 * around today, and events created or edited in Eve Hub are written to
 * Google first (with Google sending the invitations), then mirrored back.
 */
export const googleCalendarConnector: EveConnector<GoogleCalendarConfig, GoogleCalendarCredentials> = registerConnector<
  GoogleCalendarConfig,
  GoogleCalendarCredentials
>({
  id: 'google-calendar',
  label: 'Google Agenda',
  description: 'Mostra e cria os compromissos de uma conta do Google Agenda na Agenda do Time.',
  category: 'external',
  auth: 'oauth2',
  // The generic record write() doesn't fit events; the calendar face below does the writing.
  capabilities: { read: true, write: false, webhook: false },
  // Far below the Calendar API's per-user quota.
  rateLimit: { max: 120, windowMs: 60_000 },
  defaultSize: { w: 6, h: 6, minW: 4, minH: 4 },
  configSchema,
  credentialsSchema,
  defaultConfig: { accountEmail: '', calendarIds: ['primary'] },

  describeFields(): FieldSchema[] {
    return [
      { key: 'title', label: 'Compromisso', type: 'text', writable: false },
      { key: 'start', label: 'Início', type: 'date', writable: false },
      { key: 'calendarName', label: 'Agenda', type: 'text', writable: false },
    ];
  },

  async sync(ctx): Promise<SyncResult> {
    try {
      const token = await getAccessToken(ctx.credentials);
      const entries = await listCalendarEntries(token);
      const calendars = ctx.config.calendarIds
        .map((id) => entries.find((entry) => (id === 'primary' ? entry.primary : entry.id === id)))
        .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry))
        .map(calendarRef);
      if (calendars.length === 0) return { ok: false, error: 'Nenhuma das agendas escolhidas existe mais nessa conta do Google.' };

      const now = Date.now();
      const records: RemoteRecord[] = [];
      for (const calendar of calendars) {
        const events = await listEvents(token, calendar.id, new Date(now - SYNC_PAST_DAYS * DAY_MS), new Date(now + SYNC_FUTURE_DAYS * DAY_MS));
        for (const event of events) {
          const record = toRecord(event, calendar);
          if (record) records.push(record);
        }
      }

      const snapshot: GoogleCalendarSnapshot = { accountEmail: ctx.config.accountEmail, calendars };
      return { ok: true, data: snapshot, records };
    } catch (error) {
      return failure(error);
    }
  },

  calendar: {
    async listCalendars(ctx) {
      const token = await getAccessToken(ctx.credentials);
      return (await listCalendarEntries(token)).map((entry) => ({ ...calendarRef(entry), primary: Boolean(entry.primary) }));
    },

    async createEvent(ctx, input): Promise<CalendarWriteResult> {
      try {
        const token = await getAccessToken(ctx.credentials);
        const [event, entry] = await Promise.all([insertEvent(token, input.calendarId, toGoogleEventBody(input)), getCalendarEntry(token, input.calendarId)]);
        const record = toRecord(event, calendarRef(entry));
        return record ? { ok: true, record } : { ok: false, error: 'O Google criou o evento mas não o devolveu como esperado. Sincronize a agenda.' };
      } catch (error) {
        return failure(error);
      }
    },

    async updateEvent(ctx, remoteId, input, expectedVersion): Promise<CalendarWriteResult> {
      try {
        const { calendarId, eventId } = parseRemoteId(remoteId);
        const token = await getAccessToken(ctx.credentials);
        const [event, entry] = await Promise.all([
          patchEvent(token, calendarId, eventId, toGoogleEventBody(input), expectedVersion),
          getCalendarEntry(token, calendarId),
        ]);
        const record = toRecord(event, calendarRef(entry));
        return record ? { ok: true, record } : { ok: false, error: 'O evento não está mais visível nessa agenda.' };
      } catch (error) {
        if (error instanceof GoogleCalendarError && error.status === 412) return { ok: false, conflict: true };
        return failure(error);
      }
    },

    async deleteEvent(ctx, remoteId) {
      try {
        const { calendarId, eventId } = parseRemoteId(remoteId);
        await deleteEvent(await getAccessToken(ctx.credentials), calendarId, eventId);
        return { ok: true };
      } catch (error) {
        return failure(error);
      }
    },
  },
});
