import { JOB_MEMBER_SELECT, TASK_INCLUDE } from './jobs';

export { requireProject } from './jobs';

/** Everything a project "folder" surfaces: its jobs, and through them tasks, comments, and attachments — all scoped by projectId in one query. */
export const PROJECT_JOBS_INCLUDE = {
  collaborators: { include: { user: { select: JOB_MEMBER_SELECT } } },
  tasks: { orderBy: { position: 'asc' as const }, include: TASK_INCLUDE },
  comments: { orderBy: { createdAt: 'asc' as const }, include: { author: { select: JOB_MEMBER_SELECT } } },
  column: { select: { id: true, name: true } },
};
