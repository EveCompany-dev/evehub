import { prisma } from '@eve/core';
import { strings } from '@eve/ui';
import { canViewScheduling } from '../../../lib/permissions';
import { HttpError, type SessionUser } from '../../../lib/session';

/**
 * Members change only the posts they created; admins change any. Applies to
 * everything that alters or publishes a post (PATCH, DELETE, publish) —
 * reading stays open to everyone with the scheduling tab.
 */
export function canManagePost(user: Pick<SessionUser, 'id' | 'isOwner'>, post: { createdBy: string }): boolean {
  return user.isOwner || post.createdBy === user.id;
}

/** The post, in the caller's workspace, that the caller may change. 403 for someone else's post, 404 for none. */
export async function requireManagedPost(id: string, user: SessionUser) {
  if (!canViewScheduling(user)) throw new HttpError(403, strings.errors.notAllowedScheduling);
  const post = await prisma.scheduledPost.findUnique({ where: { id }, include: { connectorInstance: true } });
  if (!post || post.workspaceId !== user.workspaceId) throw new HttpError(404, strings.errors.notFound);
  if (!canManagePost(user, post)) throw new HttpError(403, strings.scheduling.notYourPost);
  return post;
}
