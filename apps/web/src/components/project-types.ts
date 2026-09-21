import type { ClientProfile } from '../lib/client-profile-meta';
import type { JobClientSummary, JobCollaboratorSummary, JobCommentSummary, JobTaskSummary } from './job-types';

export interface ProjectSummary {
  id: string;
  workspaceId: string;
  clientId: string;
  title: string;
  description: string | null;
  date: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectWithJobCount extends ProjectSummary {
  _count: { jobs: number };
}

export interface ProjectDetail extends ProjectSummary {
  client: JobClientSummary | null;
}

/** A job as it appears inside a project folder — includes its comments (the "chats") and column name, which the flat job list from /api/jobs doesn't carry. */
export interface ProjectJobSummary {
  id: string;
  title: string;
  description: string | null;
  dueDate: string | null;
  important: boolean;
  columnId: string;
  column: { id: string; name: string };
  clientId: string | null;
  projectId: string | null;
  collaborators: JobCollaboratorSummary[];
  tasks: JobTaskSummary[];
  comments: JobCommentSummary[];
}

export interface ClientDetail extends ClientProfile {
  id: string;
  name: string;
  notes: string | null;
  color: string | null;
  icon: string | null;
  logoUrl: string | null;
  createdAt: string;
  projectCount: number;
  jobCount: number;
}

export interface ClientUnassignedJob {
  id: string;
  title: string;
  dueDate: string | null;
  important: boolean;
  columnId: string;
  columnName: string;
}
