import { prisma } from '@eve/core';
import { strings } from '@eve/ui';
import { auth } from '../auth';

export interface SessionUser {
  id: string;
  email: string;
  name: string | null;
  image: string | null;
  isOwner: boolean;
  isSocialMedia: boolean;
  workspaceId: string;
}

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export async function getSessionUser(): Promise<SessionUser | null> {
  const session = await auth();
  const user = session?.user;
  if (!user?.id || !user.email) return null;

  return {
    id: user.id,
    email: user.email,
    name: user.name ?? null,
    image: user.image ?? null,
    isOwner: user.isOwner,
    isSocialMedia: user.isSocialMedia,
    workspaceId: user.workspaceId,
  };
}

export async function requireUser(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) throw new HttpError(401, strings.errors.unauthorized);
  return user;
}

/**
 * The product deliberately has no roles. The single exception is connector
 * credentials — those are the clients' Meta and Google Ads tokens, and letting
 * any of twenty accounts rotate them is a different risk from letting them
 * rearrange widgets.
 */
export async function requireOwner(): Promise<SessionUser> {
  const user = await requireUser();
  if (!user.isOwner) throw new HttpError(403, strings.errors.notOwner);
  return user;
}

/**
 * Loads a connector instance, enforcing that it belongs to the caller's
 * workspace. Every instance-scoped route must go through this: an id in a URL
 * is not proof of access.
 */
export async function requireInstance(instanceId: string, user: SessionUser) {
  const instance = await prisma.connectorInstance.findUnique({ where: { id: instanceId } });
  if (!instance || instance.workspaceId !== user.workspaceId) {
    throw new HttpError(404, strings.errors.notFound);
  }
  return instance;
}
