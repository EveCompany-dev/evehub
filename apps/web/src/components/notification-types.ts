export type NotificationType =
  | 'jobCollaboratorAdded'
  | 'jobTaskDone'
  | 'teamMessageMention'
  | 'markedImportant'
  | 'scheduledPostFailed';

export interface NotificationSummary {
  id: string;
  type: NotificationType;
  message: string;
  jobId: string | null;
  job: { id: string; title: string } | null;
  readAt: string | null;
  createdAt: string;
}
