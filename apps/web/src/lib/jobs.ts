import { Prisma, prisma } from '@eve/core';
import { strings } from '@eve/ui';
import { HttpError, type SessionUser } from './session';

export const JOB_MEMBER_SELECT = { id: true, name: true, email: true, image: true } as const;

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
};

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

export async function requireJob(id: string, workspaceId: string) {
  const job = await prisma.job.findUnique({ where: { id } });
  if (!job || job.workspaceId !== workspaceId) throw new HttpError(404, strings.errors.notFound);
  return job;
}

export async function requireTask(jobId: string, taskId: string) {
  const task = await prisma.jobTask.findUnique({ where: { id: taskId } });
  if (!task || task.jobId !== jobId) throw new HttpError(404, strings.errors.notFound);
  return task;
}

/** Moves a job to a destination column, writing sequential positions for the column's full new order in one transaction. */
export async function applyJobMove(
  user: SessionUser,
  jobId: string,
  move: { columnId: string; order: string[] },
): Promise<string | null> {
  const column = await prisma.jobColumn.findUnique({ where: { id: move.columnId } });
  if (!column || column.workspaceId !== user.workspaceId) throw new HttpError(404, 'Coluna não encontrada.');
  if (!move.order.includes(jobId)) return 'A lista de ordem precisa incluir o job que está sendo movido.';

  const existing = await prisma.job.findMany({ where: { columnId: move.columnId }, select: { id: true } });
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
