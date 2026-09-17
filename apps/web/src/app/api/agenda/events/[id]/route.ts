import { prisma } from '@eve/core';
import { strings } from '@eve/ui';
import { z } from 'zod';
import { AGENDA_EVENT_INCLUDE } from '../route';
import { fail, handle, ok } from '../../../../../lib/api';
import { canViewScheduling } from '../../../../../lib/permissions';
import { HttpError, requireUser } from '../../../../../lib/session';

export const runtime = 'nodejs';

const patchSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  description: z.string().max(4000).nullable().optional(),
  startAt: z.string().datetime().optional(),
  endAt: z.string().datetime().nullable().optional(),
  allDay: z.boolean().optional(),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .nullable()
    .optional(),
  clientId: z.string().min(1).nullable().optional(),
  attendeeIds: z.array(z.string().min(1)).max(50).optional(),
});

async function requireEvent(id: string, workspaceId: string) {
  const event = await prisma.agendaEvent.findUnique({ where: { id } });
  if (!event || event.workspaceId !== workspaceId) throw new HttpError(404, strings.errors.notFound);
  return event;
}

/** Creator-only edit — same rule as job comments/team messages: you can only change what you made. */
export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const user = await requireUser();
    if (!canViewScheduling(user)) throw new HttpError(403, strings.errors.notAllowedScheduling);

    const { id } = await context.params;
    const event = await requireEvent(id, user.workspaceId);
    if (event.createdBy !== user.id) return fail(403, strings.errors.notCommentAuthor);

    const body = patchSchema.safeParse(await request.json());
    if (!body.success) return fail(400, strings.errors.invalidPayload);

    if (body.data.attendeeIds) {
      const attendeeIds = [...new Set(body.data.attendeeIds)];
      const validCount = await prisma.user.count({ where: { id: { in: attendeeIds }, workspaceId: user.workspaceId } });
      if (validCount !== attendeeIds.length) return fail(400, 'Um ou mais participantes não pertencem a este workspace.');
    }

    const updated = await prisma.agendaEvent.update({
      where: { id },
      data: {
        ...(body.data.title !== undefined ? { title: body.data.title } : {}),
        ...(body.data.description !== undefined ? { description: body.data.description } : {}),
        ...(body.data.startAt !== undefined ? { startAt: new Date(body.data.startAt) } : {}),
        ...(body.data.endAt !== undefined ? { endAt: body.data.endAt ? new Date(body.data.endAt) : null } : {}),
        ...(body.data.allDay !== undefined ? { allDay: body.data.allDay } : {}),
        ...(body.data.color !== undefined ? { color: body.data.color } : {}),
        ...(body.data.clientId !== undefined ? { clientId: body.data.clientId } : {}),
        ...(body.data.attendeeIds
          ? { attendees: { deleteMany: {}, create: [...new Set(body.data.attendeeIds)].map((userId) => ({ userId })) } }
          : {}),
      },
      include: AGENDA_EVENT_INCLUDE,
    });

    return ok({ event: updated });
  });
}

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const user = await requireUser();
    if (!canViewScheduling(user)) throw new HttpError(403, strings.errors.notAllowedScheduling);

    const { id } = await context.params;
    const event = await requireEvent(id, user.workspaceId);
    if (event.createdBy !== user.id) return fail(403, strings.errors.notCommentAuthor);

    await prisma.agendaEvent.delete({ where: { id } });
    return ok({ ok: true });
  });
}
