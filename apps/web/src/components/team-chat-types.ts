import type { JobMember } from './job-types';

export interface TeamMessageAttachmentSummary {
  id: string;
  filename: string;
  url: string;
  size: number;
}

export interface TeamMessageSummary {
  id: string;
  body: string;
  author: JobMember;
  authorId: string;
  attachments: TeamMessageAttachmentSummary[];
  mentions: { userId: string }[];
  createdAt: string;
}
