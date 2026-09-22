export interface ClientOption {
  source: 'local';
  id: string;
  label: string;
}

export interface MetaAccount {
  id: string;
  label: string;
  status: string;
  hasInstagram: boolean;
}

export interface ScheduledPostRow {
  id: string;
  connectorInstanceId: string;
  clientId: string | null;
  clientLabel: string;
  platform: 'instagram' | 'facebook';
  postType: 'feed' | 'story' | 'reel';
  caption: string;
  mediaUrl: string;
  /** Present only for Instagram feed carousels (2-10 images); mediaUrls[0] === mediaUrl. */
  mediaUrls?: string[] | null;
  scheduledFor: string;
  status: 'draft' | 'scheduled' | 'publishing' | 'published' | 'failed';
  statusMessage: string | null;
  metaPostId: string | null;
  createdBy: string;
}

export const POST_TYPE_LABEL: Record<ScheduledPostRow['postType'], string> = {
  feed: 'post',
  story: 'story',
  reel: 'reel',
};

export const POST_STATUS_LABEL: Record<ScheduledPostRow['status'], string> = {
  draft: 'rascunho',
  scheduled: 'agendado',
  publishing: 'publicando',
  published: 'publicado',
  failed: 'falhou',
};
