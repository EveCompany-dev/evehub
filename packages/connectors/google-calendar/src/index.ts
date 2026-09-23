// Importing this package registers the connector as a side effect.
export { googleCalendarConnector, type GoogleCalendarConfig, type GoogleCalendarCredentials } from './connector';
export { GoogleCalendarError, describeError, getAccessToken, resetTokenCacheForTests } from './calendar-client';
export {
  CLIENT_PROPERTY,
  DEFAULT_TIME_ZONE,
  EVENT_COLORS,
  GOOGLE_CALENDAR_SCOPES,
  PRIVATE_TITLE,
  parseRemoteId,
  toEventData,
  toGoogleEventBody,
  toRemoteId,
  type CalendarRef,
  type GoogleCalendarSnapshot,
  type GoogleEvent,
} from './shared';
