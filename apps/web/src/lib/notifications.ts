import { prisma, type NotificationType } from '@eve/core';

/**
 * A side effect of other actions (adding a collaborator, finishing a task) —
 * never created directly from a client request. Silently skips notifying
 * someone about their own action.
 */
export async function notify(params: {
  workspaceId: string;
  userId: string;
  actorId: string;
  type: NotificationType;
  message: string;
  jobId?: string;
}): Promise<void> {
  if (params.userId === params.actorId) return;
  await prisma.notification.create({
    data: {
      workspaceId: params.workspaceId,
      userId: params.userId,
      type: params.type,
      message: params.message,
      jobId: params.jobId ?? null,
    },
  });
}
