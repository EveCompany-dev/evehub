import { JOB_MEMBER_SELECT } from './jobs';

export const DIRECT_MESSAGE_INCLUDE = {
  author: { select: JOB_MEMBER_SELECT },
  attachments: { orderBy: { createdAt: 'asc' as const } },
};

/** Canonical (userAId, userBId) pair — always the smaller id first, so a pair never exists as two rows. */
export function canonicalPair(userId: string, otherUserId: string): [string, string] {
  return userId < otherUserId ? [userId, otherUserId] : [otherUserId, userId];
}
