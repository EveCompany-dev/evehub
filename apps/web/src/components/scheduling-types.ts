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
