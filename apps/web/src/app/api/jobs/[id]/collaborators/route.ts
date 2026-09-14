import { prisma } from '@eve/core';
import { strings } from '@eve/ui';
import { z } from 'zod';
import { fail, handle, ok } from '../../../../../lib/api';
import { JOB_INCLUDE, requireJob } from '../../../../../lib/jobs';
import { notify } from '../../../../../lib/notifications';
import { requireUser } from '../../../../../lib/session';

export const runtime = 'nodejs';

const bodySchema = z.object({ userId: z.string().min(1) });

/** Adds one collaborator to a job — direct add/remove, not a full-list replace, matching how work actually hands off between people. */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const user = await requireUser();
    const { id } = await context.params;
    const job = await requireJob(id, user.workspaceId);

    const body = bodySchema.safeParse(await request.json());
    if (!body.success) return fail(400, strings.errors.invalidPayload);

    const collaborator = await prisma.user.findUnique({ where: { id: body.data.userId } });
    if (!collaborator || collaborator.workspaceId !== user.workspaceId) {
      return fail(400, 'Esse usuário não pertence a este workspace.');
    }

    await prisma.jobCollaborator.upsert({
      where: { jobId_userId: { jobId: id, userId: body.data.userId } },
      create: { jobId: id, userId: body.data.userId },
      update: {},
    });

    await notify({
      workspaceId: user.workspaceId,
      userId: body.data.userId,
      actorId: user.id,
      type: 'jobCollaboratorAdded',
      message: `${user.name ?? user.email} adicionou você ao job "${job.title}".`,
      jobId: id,
    });

    const updated = await prisma.job.findUnique({ where: { id }, include: JOB_INCLUDE });
    return ok({ job: updated }, 201);
  });
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const user = await requireUser();
    const { id } = await context.params;
    await requireJob(id, user.workspaceId);

    const body = bodySchema.safeParse(await request.json());
    if (!body.success) return fail(400, strings.errors.invalidPayload);

    await prisma.jobCollaborator.deleteMany({ where: { jobId: id, userId: body.data.userId } });

    const job = await prisma.job.findUnique({ where: { id }, include: JOB_INCLUDE });
    return ok({ job });
  });
}
