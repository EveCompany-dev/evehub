import { prisma } from '@eve/core';
import { strings } from '@eve/ui';
import { z } from 'zod';
import { fail, handle, ok } from '../../../../lib/api';
import { JOB_MEMBER_SELECT } from '../../../../lib/jobs';
import { canViewScheduling } from '../../../../lib/permissions';
import { HttpError, requireUser } from '../../../../lib/session';

export const runtime = 'nodejs';

export const AGENDA_EVENT_INCLUDE = {
  createdByUser: { select: JOB_MEMBER_SELECT },
  client: { select: { id: true, name: true } },
  attendees: { include: { user: { select: JOB_MEMBER_SELECT } } },
};

const createSchema = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().max(4000).optional(),
  startAt: z.string().datetime(),
  endAt: z.string().datetime().optional(),
  allDay: z.boolean().default(false),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .optional(),
  clientId: z.string().min(1).optional(),
  attendeeIds: z.array(z.string().min(1)).max(50).default([]),
});

/** Lists AgendaEvents in a date range, optionally filtered by attendee (member) or client. */
export async function GET(request: Request): Promise<Response> {
  return handle(async () => {
    const user = await requireUser();
    if (!canViewScheduling(user)) throw new HttpError(403, strings.errors.notAllowedScheduling);

    const url = new URL(request.url);
    const from = url.searchParams.get('from');
    const to = url.searchParams.get('to');
    const memberId = url.searchParams.get('member');
    const clientId = url.searchParams.get('client');

    const events = await prisma.agendaEvent.findMany({
      where: {
        workspaceId: user.workspaceId,
        ...(from || to
          ? { startAt: { ...(from ? { gte: new Date(from) } : {}), ...(to ? { lte: new Date(to) } : {}) } }
          : {}),
        ...(clientId ? { clientId } : {}),
        ...(memberId ? { attendees: { some: { userId: memberId } } } : {}),
      },
      orderBy: { startAt: 'asc' },
      include: AGENDA_EVENT_INCLUDE,
    });

    return ok({ events });
  });
}

export async function POST(request: Request): Promise<Response> {
  return handle(async () => {
    const user = await requireUser();
    if (!canViewScheduling(user)) throw new HttpError(403, strings.errors.notAllowedScheduling);

    const body = createSchema.safeParse(await request.json());
    if (!body.success) return fail(400, body.error.issues.map((issue) => issue.message).join('; '));

    const attendeeIds = [...new Set(body.data.attendeeIds)];
    if (attendeeIds.length > 0) {
      const validCount = await prisma.user.count({ where: { id: { in: attendeeIds }, workspaceId: user.workspaceId } });
      if (validCount !== attendeeIds.length) return fail(400, 'Um ou mais participantes não pertencem a este workspace.');
    }

    const event = await prisma.agendaEvent.create({
      data: {
        workspaceId: user.workspaceId,
        title: body.data.title,
        description: body.data.description ?? null,
        startAt: new Date(body.data.startAt),
        endAt: body.data.endAt ? new Date(body.data.endAt) : null,
        allDay: body.data.allDay,
        color: body.data.color ?? null,
        clientId: body.data.clientId ?? null,
        createdBy: user.id,
        attendees: { create: attendeeIds.map((userId) => ({ userId })) },
      },
      include: AGENDA_EVENT_INCLUDE,
    });

    return ok({ event }, 201);
  });
}
