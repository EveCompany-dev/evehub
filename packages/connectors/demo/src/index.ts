// Importing this package registers the connector as a side effect. The apps
// import it once at their entry point; nothing in @eve/core ever refers to a
// concrete connector.
export { demoConnector, type DemoConfig } from './connector';
export { DEMO_STATUSES, EDITABLE_FIELDS, type DemoStatus, type EditableField } from './shared';
export { createMemoryStore, createRedisStore, setDemoStore, type DemoRecord, type DemoRemoteStore } from './store';
