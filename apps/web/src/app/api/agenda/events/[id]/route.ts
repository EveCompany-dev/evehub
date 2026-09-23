import { strings } from '@eve/ui';
import { logActivity, quoted, whenLabel } from '../../../../../lib/activity';
import { agendaEventSchema, deleteAgendaEvent, updateAgendaEvent } from '../../../../../lib/agenda';
import { fail, handle, ok } from '../../../../../lib/api';
import { canViewScheduling } from '../../../../../lib/permissions';
import { HttpError, requireUser } from '../../../../../lib/session';

export const runtime = 'nodejs';

/**
 * Edits an appointment in Google Agenda. Anyone with the Agenda tab can: the
 * team calendar is the shared marketing@ one, which everybody already edits
 * in Google. Private events are refused — those are edited in Google only.
 */
export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const user = await requireUser();
    if (!canViewScheduling(user)) throw new HttpError(403, strings.errors.notAllowedScheduling);

    const body = agendaEventSchema.safeParse(await request.json());
    if (!body.success) return fail(400, body.error.issues.map((issue) => issue.message).join('; '));

    const { id } = await context.params;
    const { before, event } = await updateAgendaEvent(user.workspaceId, id, body.data);
    await logActivity(user, {
      action: 'agenda.update',
      summary:
        before !== event.title
          ? `renomeou o evento ${quoted(before)} para ${quoted(event.title)} no Google Agenda`
          : `editou o evento ${quoted(event.title)} (${whenLabel(new Date(event.start), !event.allDay)}) no Google Agenda`,
      entityType: 'agendaEvent',
      entityId: event.id,
    });
    return ok({ event });
  });
}

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const user = await requireUser();
    if (!canViewScheduling(user)) throw new HttpError(403, strings.errors.notAllowedScheduling);

    const { id } = await context.params;
    const { title } = await deleteAgendaEvent(user.workspaceId, id);
    await logActivity(user, { action: 'agenda.delete', summary: `apagou o evento ${quoted(title)} do Google Agenda`, entityType: 'agendaEvent', entityId: id });
    return ok({ ok: true });
  });
}
