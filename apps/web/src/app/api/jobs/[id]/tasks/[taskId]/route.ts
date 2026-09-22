import { prisma } from '@eve/core';
import { strings } from '@eve/ui';
import { z } from 'zod';
import { logActivity, personLabel, quoted } from '../../../../../../lib/activity';
import { fail, handle, ok } from '../../../../../../lib/api';
import { requireJob, requireTask, TASK_INCLUDE } from '../../../../../../lib/jobs';
import { notify } from '../../../../../../lib/notifications';
import { requireUser } from '../../../../../../lib/session';

export const runtime = 'nodejs';

const patchSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  description: z.string().trim().max(4000).nullable().optional(),
  dueDate: z.string().datetime().nullable().optional(),
  assigneeId: z.string().min(1).nullable().optional(),
  done: z.boolean().optional(),
  important: z.boolean().optional(),
  order: z.array(z.string().min(1)).min(1).optional(),
});

/** Reorders every task on this job in one shot — the client sends the whole new order, not a delta. */
async function applyReorder(jobId: string, order: string[]): Promise<string | null> {
  const existing = await prisma.jobTask.findMany({ where: { jobId }, select: { id: true } });
  const existingIds = new Set(existing.map((task) => task.id));

  if (order.length !== existingIds.size || order.some((id) => !existingIds.has(id))) {
    return 'A lista de ordem precisa conter exatamente as tarefas deste job.';
  }

  await prisma.$transaction(order.map((id, position) => prisma.jobTask.update({ where: { id }, data: { position } })));
  return null;
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string; taskId: string }> },
): Promise<Response> {
  return handle(async () => {
    const user = await requireUser();
    const { id, taskId } = await context.params;
    const job = await requireJob(id, user.workspaceId);
    const existingTask = await requireTask(id, taskId);

    const body = patchSchema.safeParse(await request.json());
    if (!body.success) return fail(400, strings.errors.invalidPayload);

    if (body.data.order) {
      const reorderError = await applyReorder(id, body.data.order);
      if (reorderError) return fail(400, reorderError);
    }

    let assigneeLabel: string | null = null;
    if (body.data.assigneeId) {
      const assignee = await prisma.user.findUnique({ where: { id: body.data.assigneeId } });
      if (!assignee || assignee.workspaceId !== user.workspaceId) {
        return fail(400, 'Esse responsável não pertence a este workspace.');
      }
      assigneeLabel = personLabel(assignee);
    }

    const { title, description, dueDate, assigneeId, done, important } = body.data;
    if (
      title !== undefined ||
      description !== undefined ||
      dueDate !== undefined ||
      assigneeId !== undefined ||
      done !== undefined ||
      important !== undefined
    ) {
      await prisma.jobTask.update({
        where: { id: taskId },
        data: {
          ...(title !== undefined ? { title } : {}),
          ...(description !== undefined ? { description } : {}),
          ...(dueDate !== undefined ? { dueDate: dueDate ? new Date(dueDate) : null } : {}),
          ...(assigneeId !== undefined ? { assigneeId } : {}),
          ...(done !== undefined ? { done } : {}),
          ...(important !== undefined ? { important } : {}),
        },
      });

      const taskName = quoted(existingTask.title);
      const where = `no job ${quoted(job.title)}`;
      const changes: { action: string; summary: string }[] = [];
      if (done !== undefined && done !== existingTask.done) {
        changes.push({ action: 'job.task.done', summary: done ? `concluiu a tarefa ${taskName} ${where}` : `reabriu a tarefa ${taskName} ${where}` });
      }
      if (assigneeId !== undefined && assigneeId !== existingTask.assigneeId) {
        changes.push({
          action: 'job.task.update',
          summary: assigneeId ? `passou a tarefa ${taskName} ${where} para ${assigneeLabel ?? 'alguém'}` : `tirou o responsável da tarefa ${taskName} ${where}`,
        });
      }
      const edited: string[] = [];
      if (title !== undefined && title !== existingTask.title) edited.push(`título para ${quoted(title)}`);
      if (description !== undefined && (description ?? null) !== existingTask.description) edited.push('descrição');
      if (dueDate !== undefined && (dueDate ? new Date(dueDate).getTime() : null) !== (existingTask.dueDate?.getTime() ?? null)) edited.push('prazo');
      if (important !== undefined && important !== existingTask.important) edited.push(important ? 'marcada como importante' : 'importante (desmarcado)');
      if (edited.length > 0) changes.push({ action: 'job.task.update', summary: `editou a tarefa ${taskName} ${where}: ${edited.join(', ')}` });
      for (const change of changes) await logActivity(user, { ...change, entityType: 'job', entityId: id });

      // Marking a task done stops the clock on it, whoever left it running.
      if (done === true) {
        await prisma.timeEntry.updateMany({ where: { taskId, endedAt: null }, data: { endedAt: new Date() } });
      }

      // Only on the false-to-true transition — resaving an already-done task
      // (e.g. reassigning it) shouldn't re-notify the creator every time.
      if (done === true && !existingTask.done) {
        await notify({
          workspaceId: user.workspaceId,
          userId: job.createdBy,
          actorId: user.id,
          type: 'jobTaskDone',
          message: `${user.name ?? user.email} concluiu a tarefa "${existingTask.title}" no job "${job.title}".`,
          jobId: id,
        });
      }

      // Same false-to-true-only rule as the job-level flag. The assignee
      // (if any and if not the actor themself) is who gets pinged — this is
      // a single-person heads-up, not a whole-job broadcast.
      const nextAssigneeId = assigneeId !== undefined ? assigneeId : existingTask.assigneeId;
      if (important === true && !existingTask.important && nextAssigneeId) {
        await notify({
          workspaceId: user.workspaceId,
          userId: nextAssigneeId,
          actorId: user.id,
          type: 'markedImportant',
          message: `${user.name ?? user.email} marcou a tarefa "${title ?? existingTask.title}" (job "${job.title}") como importante.`,
          jobId: id,
        });
      }
    }

    const task = await prisma.jobTask.findUnique({ where: { id: taskId }, include: TASK_INCLUDE });
    return ok({ task });
  });
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string; taskId: string }> },
): Promise<Response> {
  return handle(async () => {
    const user = await requireUser();
    const { id, taskId } = await context.params;
    const job = await requireJob(id, user.workspaceId);
    const task = await requireTask(id, taskId);

    await prisma.jobTask.delete({ where: { id: taskId } });
    await logActivity(user, {
      action: 'job.task.delete',
      summary: `apagou a tarefa ${quoted(task.title)} do job ${quoted(job.title)}`,
      entityType: 'job',
      entityId: id,
    });
    return ok({ ok: true });
  });
}
