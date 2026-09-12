export interface ClientOption {
  source: 'local' | 'notion';
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
  clientSource: 'local' | 'notion';
  clientId: string | null;
  clientRemoteId: string | null;
  clientLabel: string;
  platform: 'instagram' | 'facebook';
  caption: string;
  mediaUrl: string;
  scheduledFor: string;
  status: 'draft' | 'scheduled' | 'publishing' | 'published' | 'failed';
  statusMessage: string | null;
  metaPostId: string | null;
}
