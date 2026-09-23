import { strings } from '@eve/ui';
import { z } from 'zod';
import { logActivity, quoted, whenLabel } from '../../../../lib/activity';
import { agendaEventSchema, createAgendaEvent, loadAgenda } from '../../../../lib/agenda';
import { fail, handle, ok } from '../../../../lib/api';
import { canViewScheduling } from '../../../../lib/permissions';
import { HttpError, requireUser } from '../../../../lib/session';

export const runtime = 'nodejs';

const createSchema = agendaEventSchema.extend({
  /** Which connected calendar it goes in (AgendaCalendar.key). */
  calendarKey: z.string().min(1),
});

/**
 * The Agenda do Time for a date range: the connected Google calendars and
 * their appointments (re-read from Google when the copy is a couple of
 * minutes old). `connected: false` = no calendar connected, nothing to show.
 */
export async function GET(request: Request): Promise<Response> {
  return handle(async () => {
    const user = await requireUser();
    if (!canViewScheduling(user)) throw new HttpError(403, strings.errors.notAllowedScheduling);

    const url = new URL(request.url);
    const from = new Date(url.searchParams.get('from') ?? Date.now() - 31 * 24 * 60 * 60 * 1000);
    const to = new Date(url.searchParams.get('to') ?? Date.now() + 31 * 24 * 60 * 60 * 1000);
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return fail(400, 'Período inválido.');

    return ok(await loadAgenda(user.workspaceId, from, to));
  });
}

export async function POST(request: Request): Promise<Response> {
  return handle(async () => {
    const user = await requireUser();
    if (!canViewScheduling(user)) throw new HttpError(403, strings.errors.notAllowedScheduling);

    const body = createSchema.safeParse(await request.json());
    if (!body.success) return fail(400, body.error.issues.map((issue) => issue.message).join('; '));

    const event = await createAgendaEvent(user.workspaceId, body.data.calendarKey, body.data);
    await logActivity(user, {
      action: 'agenda.create',
      summary: `criou o evento ${quoted(event.title)} no Google Agenda (${event.calendarName}) para ${whenLabel(new Date(event.start), !event.allDay)}`,
      entityType: 'agendaEvent',
      entityId: event.id,
    });
    return ok({ event }, 201);
  });
}
