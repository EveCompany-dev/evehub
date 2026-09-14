import { prisma } from '@eve/core';
import { strings } from '@eve/ui';
import { z } from 'zod';
import { fail, handle, ok } from '../../../lib/api';
import { JOB_INCLUDE } from '../../../lib/jobs';
import { HttpError, requireUser } from '../../../lib/session';

export const runtime = 'nodejs';

const createSchema = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(4000).optional(),
  dueDate: z.string().datetime().nullable().optional(),
  columnId: z.string().min(1),
  collaboratorUserIds: z.array(z.string().min(1)).default([]),
});

/** Every job in the workspace, with tasks and collaborators eager-loaded — one payload for the whole board. */
export async function GET(): Promise<Response> {
  return handle(async () => {
    const user = await requireUser();

    const jobs = await prisma.job.findMany({
      where: { workspaceId: user.workspaceId },
      orderBy: [{ columnId: 'asc' }, { position: 'asc' }],
      include: JOB_INCLUDE,
    });

    return ok({ jobs });
  });
}

export async function POST(request: Request): Promise<Response> {
  return handle(async () => {
    const user = await requireUser();

    const body = createSchema.safeParse(await request.json());
    if (!body.success) return fail(400, strings.errors.invalidPayload);

    const column = await prisma.jobColumn.findUnique({ where: { id: body.data.columnId } });
    if (!column || column.workspaceId !== user.workspaceId) {
      throw new HttpError(404, 'Coluna não encontrada.');
    }

    const collaboratorIds = [...new Set(body.data.collaboratorUserIds)];
    if (collaboratorIds.length > 0) {
      const validCount = await prisma.user.count({ where: { id: { in: collaboratorIds }, workspaceId: user.workspaceId } });
      if (validCount !== collaboratorIds.length) return fail(400, 'Um ou mais colaboradores não pertencem a este workspace.');
    }

    const topPosition = await prisma.job.aggregate({ where: { columnId: column.id }, _max: { position: true } });
    const nextPosition = (topPosition._max.position ?? -1) + 1;

    const job = await prisma.job.create({
      data: {
        workspaceId: user.workspaceId,
        columnId: column.id,
        position: nextPosition,
        title: body.data.title,
        description: body.data.description || null,
        dueDate: body.data.dueDate ? new Date(body.data.dueDate) : null,
        createdBy: user.id,
        collaborators: { create: collaboratorIds.map((userId) => ({ userId })) },
      },
      include: JOB_INCLUDE,
    });

    return ok({ job }, 201);
  });
}
