import type { AnyEveConnector, EveConnector } from './types';

/**
 * The registry is stored on `globalThis` under a well-known symbol so that
 * Next.js hot-reload (which re-evaluates modules) and any duplicated copy of
 * this package still see one shared map. Without this, a connector registered
 * during dev would silently disappear on the next edit.
 */
const REGISTRY_KEY = Symbol.for('eve.hub.connector-registry');

type RegistryHolder = { [REGISTRY_KEY]?: Map<string, AnyEveConnector> };

function registry(): Map<string, AnyEveConnector> {
  const holder = globalThis as RegistryHolder;
  let map = holder[REGISTRY_KEY];
  if (!map) {
    map = new Map<string, AnyEveConnector>();
    holder[REGISTRY_KEY] = map;
  }
  return map;
}

export class ConnectorContractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConnectorContractError';
  }
}

/**
 * Registers a connector, enforcing that declared capabilities match the
 * methods actually implemented. Catching this at import time beats finding out
 * at 3am when a sync job calls an undefined `write`.
 */
export function registerConnector<Config, Credentials>(
  connector: EveConnector<Config, Credentials>,
): EveConnector<Config, Credentials> {
  const { id, capabilities } = connector;

  if (!id.trim()) {
    throw new ConnectorContractError('Connector id must not be empty.');
  }
  if (capabilities.write && typeof connector.write !== 'function') {
    throw new ConnectorContractError(`Connector "${id}" declares write capability but has no write().`);
  }
  if (capabilities.write && typeof connector.readVersion !== 'function') {
    throw new ConnectorContractError(
      `Connector "${id}" declares write capability but has no readVersion(). Undo needs it to re-read the live version before reverting.`,
    );
  }
  if (capabilities.webhook && typeof connector.onWebhook !== 'function') {
    throw new ConnectorContractError(`Connector "${id}" declares webhook capability but has no onWebhook().`);
  }
  if (connector.auth !== 'none' && !connector.credentialsSchema) {
    throw new ConnectorContractError(`Connector "${id}" requires auth "${connector.auth}" but declares no credentialsSchema.`);
  }

  const map = registry();
  const existing = map.get(id);

  if (existing) {
    // Bundlers legitimately evaluate the same module twice (Next builds one
    // chunk per entry point), producing two distinct objects that describe the
    // same connector. That is not a mistake, so compare what they declare
    // rather than object identity, and keep the first registration.
    if (fingerprint(existing) === fingerprint(connector)) {
      return existing as unknown as EveConnector<Config, Credentials>;
    }

    throw new ConnectorContractError(
      `Connector "${id}" is already registered by a different implementation ("${existing.label}" vs "${connector.label}"). Two connectors cannot share an id.`,
    );
  }

  map.set(id, connector as unknown as AnyEveConnector);
  return connector;
}

/** Identity of a connector by what it declares, not by object reference. */
function fingerprint(connector: AnyEveConnector | EveConnector<never, never> | EveConnector<unknown, unknown>): string {
  const { id, label, auth, capabilities } = connector as AnyEveConnector;
  return [id, label, auth, capabilities.read, capabilities.write, capabilities.webhook].join('|');
}

export function getConnector(id: string): AnyEveConnector | undefined {
  return registry().get(id);
}

export function requireConnector(id: string): AnyEveConnector {
  const connector = registry().get(id);
  if (!connector) {
    throw new ConnectorContractError(
      `No connector registered for id "${id}". Did the app forget to import its package?`,
    );
  }
  return connector;
}

export function listConnectors(): AnyEveConnector[] {
  return [...registry().values()].sort((a, b) => a.label.localeCompare(b.label));
}

/** Test helper. Never call this from application code. */
export function resetRegistryForTests(): void {
  registry().clear();
}
