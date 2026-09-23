/** One connected calendar the Agenda do Time shows (a Google account's calendar). */
export interface AgendaCalendar {
  /** "<connection id>|<calendar id>" — what an event is created in. */
  key: string;
  name: string;
  color: string | null;
  /** The Google account it belongs to (marketing@, someone's own). */
  accountEmail: string;
}

/** A Google Agenda appointment as the Agenda do Time shows it (see /api/agenda/events). */
export interface AgendaEventSummary {
  /** The mirrored record's id — what edits and deletes address. */
  id: string;
  title: string;
  description: string | null;
  location: string | null;
  /** ISO. All-day events: midnight UTC of the first day; `end` is the day after the last (exclusive). */
  start: string;
  end: string | null;
  allDay: boolean;
  color: string | null;
  calendarKey: string;
  calendarName: string;
  /** Opens it in Google Agenda. */
  link: string | null;
  /** Private in Google: shown only as "Ocupado", and edited only there. */
  private: boolean;
  recurring: boolean;
  /** Tagged from Eve Hub, or else a client whose name is in the title. */
  clientId: string | null;
  /** True when the tag is stored on the event, false when it was matched by name. */
  clientTagged: boolean;
  /** Everyone invited, members or not. */
  attendeeEmails: string[];
  /** The team members in it — invited, or who organized it. */
  memberIds: string[];
}
