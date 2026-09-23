export type {
  AnyEveConnector,
  CalendarEventData,
  CalendarEventInput,
  CalendarInfo,
  CalendarSource,
  CalendarWriteResult,
  ConnectorAuthKind,
  ConnectorCapabilities,
  ConnectorContext,
  ConnectorRateLimit,
  EveConnector,
  FieldSchema,
  FieldType,
  RemoteRecord,
  SyncResult,
  WritePatch,
  WriteResult,
} from './types';

export { autoDetectFields } from './auto-fields';

export {
  ConnectorContractError,
  getConnector,
  listConnectors,
  registerConnector,
  requireConnector,
  resetRegistryForTests,
} from './registry';
