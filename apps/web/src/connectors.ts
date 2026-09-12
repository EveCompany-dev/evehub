/**
 * Single wiring point between the app and the concrete connectors.
 *
 * Importing a connector package registers it as a side effect. `@eve/core`
 * never imports any of these — it only ever talks to the registry. Adding an
 * integration in v0.0.4 means one new line here and nothing else in the core.
 */
import '@eve/connector-calculator';
import '@eve/connector-calendar';
import '@eve/connector-chat';
import '@eve/connector-demo';
import '@eve/connector-meta';
import '@eve/connector-notes';
import '@eve/connector-notion';

export { listConnectors, requireConnector } from '@eve/connector-sdk';
