import { prisma } from '@eve/core';
import { strings } from '@eve/ui';
import { z } from 'zod';
import { fail, handle, ok } from '../../../../lib/api';
import { applyJobMove, JOB_INCLUDE, requireClient, requireJob } from '../../../../lib/jobs';
import { notify } from '../../../../lib/notifications';
import { requireUser } from '../../../../lib/session';

export const runtime = 'nodejs';

const patchSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  description: z.string().trim().max(4000).nullable().optional(),
  dueDate: z.string().datetime().nullable().optional(),
  clientId: z.string().min(1).nullable().optional(),
  important: z.boolean().optional(),
  move: z
    .object({
      columnId: z.string().min(1),
      order: z.array(z.string().min(1)).min(1),
    })
    .optional(),
});

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const user = await requireUser();
    const { id } = await context.params;
    await requireJob(id, user.workspaceId);

    const job = await prisma.job.findUnique({ where: { id }, include: JOB_INCLUDE });
    return ok({ job });
  });
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const user = await requireUser();
    const { id } = await context.params;
    const existing = await requireJob(id, user.workspaceId);

    const body = patchSchema.safeParse(await request.json());
    if (!body.success) return fail(400, strings.errors.invalidPayload);

    if (body.data.move) {
      const moveError = await applyJobMove(user, id, body.data.move);
      if (moveError) return fail(400, moveError);
    }

    const { title, description, dueDate, clientId, important } = body.data;
    if (clientId) await requireClient(clientId, user.workspaceId);

    if (title !== undefined || description !== undefined || dueDate !== undefined || clientId !== undefined || important !== undefined) {
      await prisma.job.update({
        where: { id },
        data: {
          ...(title !== undefined ? { title } : {}),
          ...(description !== undefined ? { description } : {}),
          ...(dueDate !== undefined ? { dueDate: dueDate ? new Date(dueDate) : null } : {}),
          ...(clientId !== undefined ? { clientId } : {}),
          ...(important !== undefined ? { important } : {}),
        },
      });

      // Only on the false-to-true transition — resaving an already-important
      // job (e.g. editing its description) shouldn't re-notify everyone.
      if (important === true && !existing.important) {
        const collaborators = await prisma.jobCollaborator.findMany({ where: { jobId: id }, select: { userId: true } });
        await Promise.all(
          collaborators.map((collaborator) =>
            notify({
              workspaceId: user.workspaceId,
              userId: collaborator.userId,
              actorId: user.id,
              type: 'markedImportant',
              message: `${user.name ?? user.email} marcou o job "${title ?? existing.title}" como importante.`,
              jobId: id,
            }),
          ),
        );
      }
    }

    const job = await prisma.job.findUnique({ where: { id }, include: JOB_INCLUDE });
    return ok({ job });
  });
}

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const user = await requireUser();
    const { id } = await context.params;
    await requireJob(id, user.workspaceId);

    await prisma.job.delete({ where: { id } });
    return ok({ ok: true });
  });
}
