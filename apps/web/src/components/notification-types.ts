export type NotificationType =
  | 'jobCollaboratorAdded'
  | 'jobTaskDone'
  | 'teamMessageMention'
  | 'markedImportant'
  | 'scheduledPostFailed'
  | 'directMessage'
  | 'connectorSyncFailed'
  | 'connectorSyncRecovered';

/**
 * Where clicking a notification goes, or null when there is nowhere useful to
 * send somebody. Shared so the bell and the notifications page can never
 * disagree about it.
 */
export function notificationHref(notification: Pick<NotificationSummary, 'type' | 'jobId'>): string | null {
  if (notification.jobId) return `/jobs?job=${notification.jobId}`;
  if (notification.type === 'teamMessageMention') return '/chat';
  // Both sides of a connector alert lead to the page that can fix it.
  if (notification.type === 'connectorSyncFailed' || notification.type === 'connectorSyncRecovered') return '/connectors';
  return null;
}

export interface NotificationSummary {
  id: string;
  type: NotificationType;
  message: string;
  jobId: string | null;
  job: { id: string; title: string } | null;
  readAt: string | null;
  createdAt: string;
}
