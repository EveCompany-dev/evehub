import { prisma } from '@eve/core';
import { strings } from '@eve/ui';
import { z } from 'zod';
import { logActivity, quoted } from '../../../../../../lib/activity';
import { fail, handle, ok } from '../../../../../../lib/api';
import { JOB_MEMBER_SELECT, requireJob } from '../../../../../../lib/jobs';
import { HttpError, requireUser } from '../../../../../../lib/session';

export const runtime = 'nodejs';

const TIME_ENTRY_INCLUDE = {
  user: { select: JOB_MEMBER_SELECT },
  task: { select: { id: true, title: true } },
  job: { select: { id: true, title: true } },
} as const;

const patchSchema = z
  .object({
    stop: z.literal(true).optional(),
    durationMinutes: z.number().min(1).max(24 * 60).optional(),
  })
  .refine((data) => data.stop !== undefined || data.durationMinutes !== undefined, {
    message: strings.errors.invalidPayload,
  });

async function requireEntry(jobId: string, entryId: string) {
  const entry = await prisma.timeEntry.findUnique({ where: { id: entryId } });
  if (!entry || entry.jobId !== jobId) throw new HttpError(404, strings.errors.notFound);
  return entry;
}

/** O apontamento e de quem trabalhou: so a propria pessoa (ou um admin) mexe nele. */
function requireOwnEntry(entry: { userId: string }, user: { id: string; isOwner: boolean }): void {
  if (entry.userId !== user.id && !user.isOwner) {
    throw new HttpError(403, 'Só quem registrou este tempo (ou um administrador) pode mudar ou apagar.');
  }
}

function minutesOf(entry: { startedAt: Date; endedAt: Date | null }): number {
  return Math.round(((entry.endedAt ?? new Date()).getTime() - entry.startedAt.getTime()) / 60_000);
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string; entryId: string }> },
): Promise<Response> {
  return handle(async () => {
    const user = await requireUser();
    const { id, entryId } = await context.params;
    const job = await requireJob(id, user);
    const entry = await requireEntry(id, entryId);
    requireOwnEntry(entry, user);

    const body = patchSchema.safeParse(await request.json());
    if (!body.success) return fail(400, strings.errors.invalidPayload);

    let updatedId = entry.id;

    if (body.data.stop && !entry.endedAt) {
      const updated = await prisma.timeEntry.update({ where: { id: entryId }, data: { endedAt: new Date() } });
      updatedId = updated.id;
      await logActivity(user, {
        action: 'job.time',
        summary: `parou o cronômetro no job ${quoted(job.title)} (${minutesOf(updated)} min)`,
        entityType: 'job',
        entityId: id,
      });
    }

    if (body.data.durationMinutes !== undefined) {
      // Editing "time spent" only makes sense for a finished recording — a
      // running entry's end time is still open-ended by definition.
      if (!entry.endedAt) return fail(400, 'So e possivel editar registros ja finalizados.');
      const newEndedAt = new Date(entry.startedAt.getTime() + body.data.durationMinutes * 60_000);
      const updated = await prisma.timeEntry.update({ where: { id: entryId }, data: { endedAt: newEndedAt } });
      updatedId = updated.id;
      await logActivity(user, {
        action: 'job.time',
        summary: `corrigiu um apontamento de horas no job ${quoted(job.title)} de ${minutesOf(entry)} para ${body.data.durationMinutes} min`,
        entityType: 'job',
        entityId: id,
      });
    }

    const full = await prisma.timeEntry.findUnique({ where: { id: updatedId }, include: TIME_ENTRY_INCLUDE });
    return ok({ entry: full });
  });
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string; entryId: string }> },
): Promise<Response> {
  return handle(async () => {
    const user = await requireUser();
    const { id, entryId } = await context.params;
    const job = await requireJob(id, user);
    const entry = await requireEntry(id, entryId);
    requireOwnEntry(entry, user);

    await prisma.timeEntry.delete({ where: { id: entryId } });
    await logActivity(user, {
      action: 'job.time',
      summary: `apagou um apontamento de ${minutesOf(entry)} min do job ${quoted(job.title)}`,
      entityType: 'job',
      entityId: id,
    });
    return ok({ ok: true });
  });
}
