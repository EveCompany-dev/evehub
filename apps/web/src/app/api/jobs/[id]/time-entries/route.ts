import { prisma } from '@eve/core';
import { strings } from '@eve/ui';
import { z } from 'zod';
import { logActivity, quoted } from '../../../../../lib/activity';
import { fail, handle, ok } from '../../../../../lib/api';
import { JOB_MEMBER_SELECT, requireJob, requireTask } from '../../../../../lib/jobs';
import { requireUser } from '../../../../../lib/session';

export const runtime = 'nodejs';

const TIME_ENTRY_INCLUDE = {
  user: { select: JOB_MEMBER_SELECT },
  task: { select: { id: true, title: true } },
  job: { select: { id: true, title: true } },
} as const;

const startSchema = z.object({ taskId: z.string().min(1).nullable().optional() });

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const user = await requireUser();
    const { id } = await context.params;
    await requireJob(id, user);

    const entries = await prisma.timeEntry.findMany({
      where: { jobId: id },
      orderBy: { startedAt: 'desc' },
      include: TIME_ENTRY_INCLUDE,
    });

    return ok({ entries });
  });
}

/**
 * Starts a timer for the caller, on this job or one of its tasks. Only one
 * timer can run per person at a time — starting a new one auto-stops
 * whatever the caller still had running (any job), same as Toggl-style tools.
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const user = await requireUser();
    const { id } = await context.params;
    const job = await requireJob(id, user);

    const body = startSchema.safeParse(await request.json());
    if (!body.success) return fail(400, strings.errors.invalidPayload);

    const task = body.data.taskId ? await requireTask(id, body.data.taskId) : null;

    const now = new Date();
    await prisma.timeEntry.updateMany({
      where: { userId: user.id, endedAt: null },
      data: { endedAt: now },
    });

    const entry = await prisma.timeEntry.create({
      data: { jobId: id, taskId: body.data.taskId ?? null, userId: user.id, startedAt: now },
      include: TIME_ENTRY_INCLUDE,
    });

    await logActivity(user, {
      action: 'job.time',
      summary: task
        ? `iniciou o cronômetro na tarefa ${quoted(task.title)} do job ${quoted(job.title)}`
        : `iniciou o cronômetro no job ${quoted(job.title)}`,
      entityType: 'job',
      entityId: id,
    });

    return ok({ entry }, 201);
  });
}
