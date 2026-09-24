import { prisma } from '@eve/core';
import { strings } from '@eve/ui';
import { z } from 'zod';
import { logActivity, quoted } from '../../../../lib/activity';
import { fail, handle, ok } from '../../../../lib/api';
import { applyJobMove, destroyJobs, JOB_INCLUDE, jobPeople, purgeExpiredJobs, requireClient, requireJob, requireProject } from '../../../../lib/jobs';
import { notify } from '../../../../lib/notifications';
import { canConcludeJob, canManageJobLifecycle } from '../../../../lib/permissions';
import { HttpError, requireUser } from '../../../../lib/session';

export const runtime = 'nodejs';

const patchSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  description: z.string().trim().max(4000).nullable().optional(),
  dueDate: z.string().datetime().nullable().optional(),
  clientId: z.string().min(1).nullable().optional(),
  projectId: z.string().min(1).nullable().optional(),
  important: z.boolean().optional(),
  responsibleId: z.string().min(1).nullable().optional(),
  /** true = Concluir (the job's people or an admin); false = reabrir (admin). */
  concluded: z.boolean().optional(),
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
    await requireJob(id, user);

    const job = await prisma.job.findUnique({ where: { id }, include: JOB_INCLUDE });
    return ok({ job });
  });
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const user = await requireUser();
    const { id } = await context.params;
    const existing = await requireJob(id, user);

    const body = patchSchema.safeParse(await request.json());
    if (!body.success) return fail(400, strings.errors.invalidPayload);

    if (body.data.concluded !== undefined && body.data.concluded !== (existing.concludedAt !== null)) {
      if (body.data.concluded) {
        if (!canConcludeJob(user, await jobPeople(existing))) throw new HttpError(403, strings.errors.notJobPeople);
        await prisma.job.update({ where: { id }, data: { concludedAt: new Date(), concludedBy: user.id } });
        await logActivity(user, { action: 'job.conclude', summary: `concluiu o job ${quoted(existing.title)}`, entityType: 'job', entityId: id });
      } else {
        if (!canManageJobLifecycle(user)) throw new HttpError(403, strings.errors.notAdminJobs);
        // Back at the bottom of its old column, so it can't collide with the board's current order.
        const top = await prisma.job.aggregate({ where: { columnId: existing.columnId, deletedAt: null, concludedAt: null }, _max: { position: true } });
        await prisma.job.update({ where: { id }, data: { concludedAt: null, concludedBy: null, position: (top._max.position ?? -1) + 1 } });
        await logActivity(user, { action: 'job.reopen', summary: `reabriu o job ${quoted(existing.title)}`, entityType: 'job', entityId: id });
      }
    }

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

    const { title, description, dueDate, clientId, projectId, important, responsibleId } = body.data;

    if (responsibleId) {
      const member = await prisma.user.findFirst({ where: { id: responsibleId, workspaceId: user.workspaceId, disabledAt: null }, select: { id: true } });
      if (!member) return fail(400, 'Essa pessoa não pertence a este workspace.');
    }

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
      important !== undefined ||
      responsibleId !== undefined
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
          ...(responsibleId !== undefined ? { responsibleId } : {}),
        },
      });

      const changed: string[] = [];
      if (title !== undefined && title !== existing.title) changed.push(`título para ${quoted(title)}`);
      if (description !== undefined && (description ?? null) !== existing.description) changed.push('briefing');
      if (dueDate !== undefined && (dueDate ? new Date(dueDate).getTime() : null) !== (existing.dueDate?.getTime() ?? null)) {
        changed.push(dueDate ? `prazo para ${new Date(dueDate).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })}` : 'prazo (removido)');
      }
      if (nextClientId !== undefined && nextClientId !== existing.clientId) changed.push('cliente');
      if (nextProjectId !== undefined && nextProjectId !== existing.projectId) changed.push('projeto');
      if (important !== undefined && important !== existing.important) changed.push(important ? 'marcado como importante' : 'importante (desmarcado)');
      if (responsibleId !== undefined && responsibleId !== existing.responsibleId) changed.push(responsibleId ? 'responsável' : 'responsável (removido)');
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

/**
 * Admin-only. Moves the job to the trash, where admins can restore it for
 * JOB_TRASH_DAYS. `?permanent=1` on a job already in the trash removes it for
 * good right away.
 */
export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const user = await requireUser();
    if (!canManageJobLifecycle(user)) throw new HttpError(403, strings.errors.notAdminJobs);
    const { id } = await context.params;
    const job = await requireJob(id, user, { allowTrashed: true });
    const permanent = new URL(request.url).searchParams.get('permanent') === '1';

    if (permanent) {
      if (!job.deletedAt) return fail(409, 'Mova o job para a lixeira antes de apagar de vez.');
      await destroyJobs([id]);
      await logActivity(user, { action: 'job.purge', summary: `apagou de vez o job ${quoted(job.title)}`, entityType: 'job', entityId: id });
      return ok({ ok: true });
    }

    if (!job.deletedAt) {
      await prisma.job.update({ where: { id }, data: { deletedAt: new Date(), deletedBy: user.id } });
      await logActivity(user, { action: 'job.delete', summary: `moveu o job ${quoted(job.title)} para a lixeira`, entityType: 'job', entityId: id });
    }
    await purgeExpiredJobs(user.workspaceId);
    return ok({ ok: true });
  });
}
