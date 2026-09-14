import { prisma } from '@eve/core';
import { strings } from '@eve/ui';
import { z } from 'zod';
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

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string; entryId: string }> },
): Promise<Response> {
  return handle(async () => {
    const user = await requireUser();
    const { id, entryId } = await context.params;
    await requireJob(id, user.workspaceId);
    const entry = await requireEntry(id, entryId);

    const body = patchSchema.safeParse(await request.json());
    if (!body.success) return fail(400, strings.errors.invalidPayload);

    let updatedId = entry.id;

    if (body.data.stop && !entry.endedAt) {
      const updated = await prisma.timeEntry.update({ where: { id: entryId }, data: { endedAt: new Date() } });
      updatedId = updated.id;
    }

    if (body.data.durationMinutes !== undefined) {
      // Editing "time spent" only makes sense for a finished recording — a
      // running entry's end time is still open-ended by definition.
      if (!entry.endedAt) return fail(400, 'So e possivel editar registros ja finalizados.');
      const newEndedAt = new Date(entry.startedAt.getTime() + body.data.durationMinutes * 60_000);
      const updated = await prisma.timeEntry.update({ where: { id: entryId }, data: { endedAt: newEndedAt } });
      updatedId = updated.id;
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
    await requireJob(id, user.workspaceId);
    await requireEntry(id, entryId);

    await prisma.timeEntry.delete({ where: { id: entryId } });
    return ok({ ok: true });
  });
}
