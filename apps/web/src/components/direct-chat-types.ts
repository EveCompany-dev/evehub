import type { JobMember } from './job-types';

export interface DirectMessageAttachmentSummary {
  id: string;
  filename: string;
  url: string;
  size: number;
}

export interface DirectMessageSummary {
  id: string;
  body: string;
  author: JobMember;
  authorId: string;
  attachments: DirectMessageAttachmentSummary[];
  createdAt: string;
}

export interface DirectConversationSummary {
  id: string;
  otherUser: JobMember;
  lastMessage: { body: string; createdAt: string } | null;
}
