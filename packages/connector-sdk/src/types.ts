import type { ZodType } from 'zod';

/** How a connector authenticates against its upstream service. */
export type ConnectorAuthKind = 'oauth2' | 'api_key' | 'token' | 'webhook' | 'none';

export interface ConnectorCapabilities {
  read: boolean;
  write: boolean;
  webhook: boolean;
}

export interface ConnectorRateLimit {
  max: number;
  windowMs: number;
}

/**
 * One object as it exists upstream (a Notion page, an ad account, a scheduled
 * post). `remoteVersion` is whatever the source uses to detect concurrent
 * change — `last_edited_time` for Notion, an ETag elsewhere. It is per record
 * on purpose: a single version for a whole table would make edits to unrelated
 * rows collide.
 */
export interface RemoteRecord {
  remoteId: string;
  remoteVersion: string;
  data: Record<string, unknown>;
}

export type SyncResult =
  | {
      ok: true;
      /** Raw payload, stored verbatim as a snapshot. Shape belongs to the connector. */
      data: unknown;
      /** Individually versioned records. Omit for read-only, record-less sources. */
      records?: RemoteRecord[];
    }
  | { ok: false; error: string };

export interface WritePatch {
  remoteId: string;
  patch: Record<string, unknown>;
  /** The `remoteVersion` the caller believes is current. */
  expectedVersion: string;
}

export type WriteResult =
  /** Applied upstream. `newVersion` is the version the source reports afterwards. */
  | { ok: true; newVersion: string; data: Record<string, unknown> }
  /** Someone changed the record first. Nothing was written. */
  | { ok: false; conflict: true; currentVersion: string | null; currentData: Record<string, unknown> | null }
  /** Anything else: network, auth, validation. */
  | { ok: false; conflict?: false; error: string };

/**
 * A generic column/field description, independent of any one connector's
 * internal schema shape (Notion's `NotionPropertySchema`, or whatever the
 * next connector invents). `key` matches a key in a `RemoteRecord.data` map.
 *
 * This is what makes the widget rendering layer config-driven: a view picks a
 * subset/order of these to show, without any widget component knowing the
 * connector's own types.
 */
export type FieldType = 'text' | 'number' | 'boolean' | 'date' | 'select';

export interface FieldSchema {
  key: string;
  label: string;
  type: FieldType;
  writable: boolean;
  /** For 'select': the allowed values, rendered as a dropdown instead of free text. */
  options?: string[];
}

export interface ConnectorContext<Config, Credentials> {
  instanceId: string;
  config: Config;
  credentials: Credentials;
  lastSyncedAt: Date | null;
}

/**
 * One appointment as a calendar connector stores it in `RemoteRecord.data`.
 * Every calendar source (Google Agenda today, Outlook or others later)
 * normalizes to this, so the Agenda do Time reads them all the same way.
 */
export interface CalendarEventData {
  title: string;
  description: string | null;
  location: string | null;
  /** ISO timestamp; for all-day events, midnight UTC of the first day. */
  start: string;
  /** ISO timestamp (exclusive for all-day events, like the sources send it); null when the source gives none. */
  end: string | null;
  allDay: boolean;
  calendarId: string;
  calendarName: string;
  /** Hex color for the chip: the event's own color, else its calendar's. */
  color: string | null;
  attendees: { email: string; name: string | null; response: string | null }[];
  organizerEmail: string | null;
  /** Opens the event in the source app. */
  link: string | null;
  /** Shared by the copies of one event across calendars — how duplicates are spotted. */
  uid: string | null;
  /** Client tagged from Eve Hub (stored on the event itself), if any. */
  clientId: string | null;
  /** Team members tagged from Eve Hub (stored on the event itself, never invited). */
  memberIds: string[];
  /** Marked private at the source: only "busy" is shown, never the details. */
  private: boolean;
  recurring: boolean;
}

/** What Eve Hub sends when creating or editing an appointment. */
export interface CalendarEventInput {
  calendarId: string;
  title: string;
  description: string | null;
  start: string;
  end: string | null;
  allDay: boolean;
  /**
   * Team members tagged on the event — stored on it, never invited: the team
   * shares one Google account and most of its addresses receive no mail.
   */
  memberIds: string[];
  clientId: string | null;
}

export interface CalendarInfo {
  id: string;
  name: string;
  color: string | null;
  primary: boolean;
}

export type CalendarWriteResult =
  | { ok: true; record: RemoteRecord }
  /** Someone changed the event at the source first. Nothing was written. */
  | { ok: false; conflict: true }
  | { ok: false; conflict?: false; error: string };

/**
 * Optional second face of a connector: a calendar the Agenda do Time shows
 * and writes to. `sync()` keeps returning every event as a record
 * (`data: CalendarEventData`); these add what the generic patch-based
 * `write()` can't express — creating, rescheduling and deleting events.
 */
export interface CalendarSource<Config, Credentials> {
  listCalendars(ctx: ConnectorContext<Config, Credentials>): Promise<CalendarInfo[]>;
  createEvent(ctx: ConnectorContext<Config, Credentials>, input: CalendarEventInput): Promise<CalendarWriteResult>;
  updateEvent(ctx: ConnectorContext<Config, Credentials>, remoteId: string, input: CalendarEventInput, expectedVersion: string): Promise<CalendarWriteResult>;
  deleteEvent(ctx: ConnectorContext<Config, Credentials>, remoteId: string): Promise<{ ok: true } | { ok: false; error: string }>;
}

/**
 * The one interface every integration implements.
 *
 * Deliberate change from the v0.0.2 draft: the React `Widget` and `ConfigForm`
 * are NOT part of this interface. The worker imports connectors to run syncs
 * and must never pull React into a Node process. The visual half lives in the
 * web app's widget registry, keyed by this same `id`.
 */
export interface EveConnector<Config = unknown, Credentials = undefined> {
  /** Stable identifier. Matches `ConnectorInstance.connectorId` in the database. */
  id: string;
  label: string;
  description?: string;

  /**
   * 'external' = a real outside service (Notion, Meta, Claude) — shown in the
   * Conectores page. 'local' = a self-contained widget with nothing to
   * "connect" (Calculator, Notes, Calendar, Demo) — still addable from the
   * dashboard's own widget palette, just not clutter on the connections page.
   * Required rather than defaulted so every new connector has to pick one
   * deliberately instead of silently landing on whichever side is the default.
   */
  category: 'external' | 'local';

  auth: ConnectorAuthKind;
  capabilities: ConnectorCapabilities;
  rateLimit?: ConnectorRateLimit;

  /** Default widget footprint on the 12-column grid. */
  defaultSize?: { w: number; h: number; minW?: number; minH?: number };

  configSchema: ZodType<Config>;
  defaultConfig: Config;
  /** Omit when `auth` is `none`. */
  credentialsSchema?: ZodType<Credentials>;

  sync(ctx: ConnectorContext<Config, Credentials>): Promise<SyncResult>;

  /**
   * Declares the columns a generic widget should render, derived from the raw
   * snapshot payload (`SyncResult.data`). Optional: a connector that skips this
   * still renders through the generic table view, via `autoDetectFields`
   * inferring columns from the first synced record instead.
   */
  describeFields?(snapshotData: unknown): FieldSchema[];

  /** Required when `capabilities.write` is true. */
  write?(ctx: ConnectorContext<Config, Credentials>, patch: WritePatch): Promise<WriteResult>;

  /**
   * Current upstream version of one record, without a full sync.
   *
   * Required when `capabilities.write` is true: undo re-reads the live version
   * before reverting, otherwise it would always send a stale `expectedVersion`
   * and conflict with itself.
   */
  readVersion?(ctx: ConnectorContext<Config, Credentials>, remoteId: string): Promise<string | null>;

  /** Required when `capabilities.webhook` is true. */
  onWebhook?(ctx: ConnectorContext<Config, Credentials>, payload: unknown): Promise<void>;

  /** Present on connectors that are a calendar the Agenda do Time can show (see CalendarSource). */
  calendar?: CalendarSource<Config, Credentials>;
}

/**
 * A connector whose generics are erased, for storage in the registry.
 *
 * `any` is load-bearing here rather than lazy: the registry holds connectors
 * with mutually incompatible Config types, and callers re-establish safety by
 * parsing through the connector's own Zod schemas before invoking it.
 */
export type AnyEveConnector = EveConnector<any, any>;
