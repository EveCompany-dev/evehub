import { JOB_MEMBER_SELECT } from './jobs';

export const TEAM_MESSAGE_INCLUDE = {
  author: { select: JOB_MEMBER_SELECT },
  attachments: { orderBy: { createdAt: 'asc' as const } },
  mentions: { select: { userId: true } },
};
