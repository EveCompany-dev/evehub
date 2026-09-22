import { prisma } from '@eve/core';
import { strings } from '@eve/ui';
import { z } from 'zod';
import { logActivity, quoted } from '../../../../lib/activity';
import { fail, handle, ok } from '../../../../lib/api';
import { applyJobMove, JOB_INCLUDE, requireClient, requireJob, requireProject } from '../../../../lib/jobs';
import { notify } from '../../../../lib/notifications';
import { requireUser } from '../../../../lib/session';

export const runtime = 'nodejs';

const patchSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  description: z.string().trim().max(4000).nullable().optional(),
  dueDate: z.string().datetime().nullable().optional(),
  clientId: z.string().min(1).nullable().optional(),
  projectId: z.string().min(1).nullable().optional(),
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
      // Reordering inside the same column is housekeeping; a column change is news.
      if (body.data.move.columnId !== existing.columnId) {
        const column = await prisma.jobColumn.findUnique({ where: { id: body.data.move.columnId }, select: { name: true } });
        await logActivity(user, {
          action: 'job.move',
          summary: `moveu o job ${quoted(existing.title)} para ${quoted(column?.name)}`,
          entityType: 'job',
          entityId: id,
        });
      }
    }

    const { title, description, dueDate, clientId, projectId, important } = body.data;

    // A job's clientId always matches its project's clientId when a project
    // is set — a project can't span clients. Setting a project takes the
    // client from it (overriding any clientId also sent this request);
    // changing the client directly (without also picking a new project)
    // drops a now-stale project link instead of leaving the two inconsistent.
    let nextClientId = clientId;
    let nextProjectId = projectId;
    if (projectId !== undefined && projectId !== null) {
      const project = await requireProject(projectId, user.workspaceId);
      nextClientId = project.clientId;
    } else if (clientId !== undefined) {
      if (clientId) await requireClient(clientId, user.workspaceId);
      if (nextProjectId === undefined && existing.projectId && clientId !== existing.clientId) {
        nextProjectId = null;
      }
    }

    if (
      title !== undefined ||
      description !== undefined ||
      dueDate !== undefined ||
      nextClientId !== undefined ||
      nextProjectId !== undefined ||
      important !== undefined
    ) {
      await prisma.job.update({
        where: { id },
        data: {
          ...(title !== undefined ? { title } : {}),
          ...(description !== undefined ? { description } : {}),
          ...(dueDate !== undefined ? { dueDate: dueDate ? new Date(dueDate) : null } : {}),
          ...(nextClientId !== undefined ? { clientId: nextClientId } : {}),
          ...(nextProjectId !== undefined ? { projectId: nextProjectId } : {}),
          ...(important !== undefined ? { important } : {}),
        },
      });

      const changed: string[] = [];
      if (title !== undefined && title !== existing.title) changed.push(`título para ${quoted(title)}`);
      if (description !== undefined && (description ?? null) !== existing.description) changed.push('descrição');
      if (dueDate !== undefined && (dueDate ? new Date(dueDate).getTime() : null) !== (existing.dueDate?.getTime() ?? null)) {
        changed.push(dueDate ? `prazo para ${new Date(dueDate).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })}` : 'prazo (removido)');
      }
      if (nextClientId !== undefined && nextClientId !== existing.clientId) changed.push('cliente');
      if (nextProjectId !== undefined && nextProjectId !== existing.projectId) changed.push('projeto');
      if (important !== undefined && important !== existing.important) changed.push(important ? 'marcado como importante' : 'importante (desmarcado)');
      if (changed.length > 0) {
        await logActivity(user, {
          action: 'job.update',
          summary: `editou o job ${quoted(existing.title)}: ${changed.join(', ')}`,
          entityType: 'job',
          entityId: id,
        });
      }

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
    const job = await requireJob(id, user.workspaceId);

    await prisma.job.delete({ where: { id } });
    await logActivity(user, { action: 'job.delete', summary: `apagou o job ${quoted(job.title)}`, entityType: 'job', entityId: id });
    return ok({ ok: true });
  });
}
