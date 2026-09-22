import { prisma } from '@eve/core';
import { strings } from '@eve/ui';
import { z } from 'zod';
import { logActivity, quoted } from '../../../../../lib/activity';
import { fail, handle, ok } from '../../../../../lib/api';
import { requireJob, TASK_INCLUDE } from '../../../../../lib/jobs';
import { requireUser } from '../../../../../lib/session';

export const runtime = 'nodejs';

const createSchema = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(4000).optional(),
  dueDate: z.string().datetime().nullable().optional(),
  assigneeId: z.string().min(1).nullable().optional(),
});

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const user = await requireUser();
    const { id } = await context.params;
    await requireJob(id, user.workspaceId);

    const tasks = await prisma.jobTask.findMany({
      where: { jobId: id },
      orderBy: { position: 'asc' },
      include: TASK_INCLUDE,
    });

    return ok({ tasks });
  });
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const user = await requireUser();
    const { id } = await context.params;
    const job = await requireJob(id, user.workspaceId);

    const body = createSchema.safeParse(await request.json());
    if (!body.success) return fail(400, strings.errors.invalidPayload);

    if (body.data.assigneeId) {
      const assignee = await prisma.user.findUnique({ where: { id: body.data.assigneeId } });
      if (!assignee || assignee.workspaceId !== user.workspaceId) {
        return fail(400, 'Esse responsável não pertence a este workspace.');
      }
    }

    const topPosition = await prisma.jobTask.aggregate({ where: { jobId: id }, _max: { position: true } });
    const nextPosition = (topPosition._max.position ?? -1) + 1;

    const task = await prisma.jobTask.create({
      data: {
        jobId: id,
        position: nextPosition,
        title: body.data.title,
        description: body.data.description || null,
        dueDate: body.data.dueDate ? new Date(body.data.dueDate) : null,
        assigneeId: body.data.assigneeId || null,
      },
      include: TASK_INCLUDE,
    });

    await logActivity(user, {
      action: 'job.task.create',
      summary: `criou a tarefa ${quoted(task.title)} no job ${quoted(job.title)}`,
      entityType: 'job',
      entityId: id,
    });

    return ok({ task }, 201);
  });
}
