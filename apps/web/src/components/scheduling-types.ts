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
  postType: 'feed' | 'story';
  caption: string;
  mediaUrl: string;
  scheduledFor: string;
  status: 'draft' | 'scheduled' | 'publishing' | 'published' | 'failed';
  statusMessage: string | null;
  metaPostId: string | null;
}
