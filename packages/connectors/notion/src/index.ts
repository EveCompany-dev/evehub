// Importar este pacote registra o connector como efeito colateral.
export { notionConnector, type NotionConfig, type NotionCredentials } from './connector';
export { NOTION_VERSION, NotionError } from './notion-client';
export { buildPropertyPayload, readPageProperties, readProperty } from './properties';
export {
  isWritableType,
  normalizeDatabaseId,
  READABLE_TYPES,
  WRITABLE_TYPES,
  type NotionPropertySchema,
  type NotionSnapshot,
} from './shared';
