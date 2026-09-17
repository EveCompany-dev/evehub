import type { JobMember } from './job-types';

export interface AgendaEventSummary {
  id: string;
  title: string;
  description: string | null;
  startAt: string;
  endAt: string | null;
  allDay: boolean;
  color: string | null;
  clientId: string | null;
  client: { id: string; name: string } | null;
  createdBy: string;
  createdByUser: JobMember;
  attendees: { user: JobMember }[];
}
