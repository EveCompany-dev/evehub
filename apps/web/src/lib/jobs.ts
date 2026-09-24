import { Prisma, prisma } from '@eve/core';
import { strings } from '@eve/ui';
import { canManageJobLifecycle } from './permissions';
import { HttpError, type SessionUser } from './session';
import { deleteUpload } from './uploads';

export const JOB_MEMBER_SELECT = { id: true, name: true, email: true, image: true } as const;

/** How long a deleted job waits in the trash before it is removed for good. */
export const JOB_TRASH_DAYS = 7;
const TRASH_MS = JOB_TRASH_DAYS * 24 * 60 * 60 * 1000;

export function isUniqueConstraintError(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

export const TASK_INCLUDE = {
  assignee: { select: JOB_MEMBER_SELECT },
  attachments: { orderBy: { createdAt: 'asc' as const }, include: { uploader: { select: JOB_MEMBER_SELECT } } },
};

export const JOB_INCLUDE = {
  collaborators: { include: { user: { select: JOB_MEMBER_SELECT } } },
  tasks: { orderBy: { position: 'asc' as const }, include: TASK_INCLUDE },
  client: { select: { id: true, name: true } },
  project: { select: { id: true, title: true } },
  responsible: { select: JOB_MEMBER_SELECT },
};

/** Jobs on the board: not concluded, not in the trash. */
export function activeJobsWhere(workspaceId: string): Prisma.JobWhereInput {
  return { workspaceId, deletedAt: null, concludedAt: null };
}

/**
 * Every job this person may open outside the board (client and project
 * pages, mentions, the assistant): never one in the trash, and a concluded
 * one only for admins.
 */
export function visibleJobsWhere(user: Pick<SessionUser, 'workspaceId' | 'isOwner'>): Prisma.JobWhereInput {
  return canManageJobLifecycle(user) ? { workspaceId: user.workspaceId, deletedAt: null } : activeJobsWhere(user.workspaceId);
}

export async function requireColumn(id: string, workspaceId: string) {
  const column = await prisma.jobColumn.findUnique({ where: { id } });
  if (!column || column.workspaceId !== workspaceId) throw new HttpError(404, strings.errors.notFound);
  return column;
}

export async function requireClient(id: string, workspaceId: string) {
  const client = await prisma.client.findUnique({ where: { id } });
  if (!client || client.workspaceId !== workspaceId) throw new HttpError(404, strings.errors.notFound);
  return client;
}

export async function requireProject(id: string, workspaceId: string) {
  const project = await prisma.project.findUnique({ where: { id } });
  if (!project || project.workspaceId !== workspaceId) throw new HttpError(404, strings.errors.notFound);
  return project;
}

/**
 * Loads a job the caller may act on. A job in the trash is invisible (404)
 * to everyone unless `allowTrashed` is set — only the restore and purge
 * routes do that, for admins. A concluded job is invisible to non-admins.
 */
export async function requireJob(id: string, user: Pick<SessionUser, 'workspaceId' | 'isOwner'>, options: { allowTrashed?: boolean } = {}) {
  const job = await prisma.job.findUnique({ where: { id } });
  if (!job || job.workspaceId !== user.workspaceId) throw new HttpError(404, strings.errors.notFound);
  if (job.deletedAt && !(options.allowTrashed && canManageJobLifecycle(user))) throw new HttpError(404, strings.errors.notFound);
  if (job.concludedAt && !canManageJobLifecycle(user)) throw new HttpError(404, strings.errors.notFound);
  return job;
}

export async function requireTask(jobId: string, taskId: string) {
  const task = await prisma.jobTask.findUnique({ where: { id: taskId } });
  if (!task || task.jobId !== jobId) throw new HttpError(404, strings.errors.notFound);
  return task;
}

/** The job's people, for canConcludeJob. */
export async function jobPeople(job: { id: string; createdBy: string; responsibleId: string | null }) {
  const collaborators = await prisma.jobCollaborator.findMany({ where: { jobId: job.id }, select: { userId: true } });
  return { createdBy: job.createdBy, responsibleId: job.responsibleId, collaboratorIds: collaborators.map((row) => row.userId) };
}

/**
 * Removes for good every job that has been in the trash longer than
 * JOB_TRASH_DAYS, with its attachment files. Runs lazily (whenever an admin
 * opens the trash or deletes a job) instead of on a schedule; a job past its
 * date is already hidden everywhere, so nothing depends on the exact moment.
 */
export async function purgeExpiredJobs(workspaceId: string, now: Date = new Date()): Promise<number> {
  const expired = await prisma.job.findMany({
    where: { workspaceId, deletedAt: { lt: new Date(now.getTime() - TRASH_MS) } },
    select: { id: true },
  });
  if (expired.length === 0) return 0;
  return destroyJobs(expired.map((job) => job.id));
}

/** Deletes jobs for real (tasks, comments, time and attachment rows cascade) and then their files. */
export async function destroyJobs(jobIds: string[]): Promise<number> {
  if (jobIds.length === 0) return 0;
  const attachments = await prisma.attachment.findMany({ where: { task: { jobId: { in: jobIds } } }, select: { url: true } });
  const { count } = await prisma.job.deleteMany({ where: { id: { in: jobIds } } });
  await Promise.all(attachments.map((attachment) => deleteUpload(attachment.url)));
  return count;
}

/** When a trashed job goes away for good. */
export function trashExpiresAt(deletedAt: Date): Date {
  return new Date(deletedAt.getTime() + TRASH_MS);
}

/**
 * Moves a job to a destination column, writing sequential positions for the
 * column's full new order in one transaction. The order covers the jobs on
 * the board only: concluded and trashed ones keep their old column but are
 * not part of it.
 */
export async function applyJobMove(
  user: SessionUser,
  jobId: string,
  move: { columnId: string; order: string[] },
): Promise<string | null> {
  const column = await prisma.jobColumn.findUnique({ where: { id: move.columnId } });
  if (!column || column.workspaceId !== user.workspaceId) throw new HttpError(404, 'Coluna não encontrada.');
  if (!move.order.includes(jobId)) return 'A lista de ordem precisa incluir o job que está sendo movido.';

  const existing = await prisma.job.findMany({ where: { ...activeJobsWhere(user.workspaceId), columnId: move.columnId }, select: { id: true } });
  const existingIds = new Set(existing.map((job) => job.id));
  existingIds.add(jobId);

  if (move.order.length !== existingIds.size || move.order.some((id) => !existingIds.has(id))) {
    return 'A lista de ordem precisa conter exatamente os jobs da coluna de destino.';
  }

  await prisma.$transaction(
    move.order.map((id, position) => prisma.job.update({ where: { id }, data: { columnId: move.columnId, position } })),
  );

  return null;
}
