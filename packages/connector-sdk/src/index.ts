export type {
  AnyEveConnector,
  ConnectorAuthKind,
  ConnectorCapabilities,
  ConnectorContext,
  ConnectorRateLimit,
  EveConnector,
  RemoteRecord,
  SyncResult,
  WritePatch,
  WriteResult,
} from './types';

export {
  ConnectorContractError,
  getConnector,
  listConnectors,
  registerConnector,
  requireConnector,
  resetRegistryForTests,
} from './registry';
