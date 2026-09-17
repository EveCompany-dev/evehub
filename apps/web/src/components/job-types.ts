export interface JobMember {
  id: string;
  name: string | null;
  email: string;
  image: string | null;
}

export interface AttachmentSummary {
  id: string;
  taskId: string;
  filename: string;
  url: string;
  size: number;
  uploader: JobMember;
  createdAt: string;
}

export interface JobTaskSummary {
  id: string;
  jobId: string;
  title: string;
  description: string | null;
  dueDate: string | null;
  assignee: JobMember | null;
  done: boolean;
  important: boolean;
  position: number;
  attachments: AttachmentSummary[];
}

export interface JobCollaboratorSummary {
  id: string;
  userId: string;
  user: JobMember;
}

export interface JobClientSummary {
  id: string;
  name: string;
}

export interface JobProjectSummary {
  id: string;
  title: string;
}

export interface JobSummary {
  id: string;
  columnId: string;
  position: number;
  title: string;
  description: string | null;
  dueDate: string | null;
  createdBy: string;
  important: boolean;
  clientId: string | null;
  client: JobClientSummary | null;
  projectId: string | null;
  project: JobProjectSummary | null;
  collaborators: JobCollaboratorSummary[];
  tasks: JobTaskSummary[];
}

export interface JobColumnSummary {
  id: string;
  name: string;
  position: number;
  color: string | null;
  colorOpacity: number | null;
  borderColor: string | null;
}

export interface JobCommentSummary {
  id: string;
  jobId: string;
  authorId: string;
  author: JobMember;
  body: string;
  createdAt: string;
}

export interface TimeEntrySummary {
  id: string;
  jobId: string;
  taskId: string | null;
  task: { id: string; title: string } | null;
  userId: string;
  user: JobMember;
  startedAt: string;
  endedAt: string | null;
  /** Only populated by the workspace-wide "running entry" lookup — per-job endpoints omit it since the job is already known from context. */
  job?: { id: string; title: string };
}

/** `#rrggbb` + 0..1 opacity -> `rgba(...)`, for the job-status badge background. Falls back to the opaque hex if the string doesn't parse. */
export function hexToRgba(hex: string, opacity: number): string {
  const match = /^#?([0-9a-fA-F]{6})$/.exec(hex.trim());
  if (!match) return hex;
  const value = match[1]!;
  const r = parseInt(value.slice(0, 2), 16);
  const g = parseInt(value.slice(2, 4), 16);
  const b = parseInt(value.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${opacity})`;
}

export function memberLabel(member: JobMember): string {
  return member.name?.trim() || member.email;
}

export function memberInitials(member: JobMember): string {
  const label = memberLabel(member);
  const parts = label.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0]![0]! + parts[1]![0]!).toUpperCase();
  return label.slice(0, 2).toUpperCase();
}

export function formatDateTimePtBr(value: string): string {
  try {
    return new Date(value).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  } catch {
    return value;
  }
}

/** Whole minutes between two ISO timestamps (or now, if `end` is null — a running entry). */
export function durationMinutes(start: string, end: string | null): number {
  const startMs = new Date(start).getTime();
  const endMs = end ? new Date(end).getTime() : Date.now();
  return Math.max(0, Math.round((endMs - startMs) / 60_000));
}

/** Elapsed time between two ISO timestamps (or now, if `end` is null — a running entry), as "1h 05m" / "05m". */
export function formatDuration(start: string, end: string | null): string {
  const totalMinutes = durationMinutes(start, end);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return hours > 0 ? `${hours}h ${String(minutes).padStart(2, '0')}m` : `${minutes}m`;
}
