import type { AnyEveConnector, ConnectorContext } from '@eve/connector-sdk';
import { requireConnector } from '@eve/connector-sdk';
import { decryptJson } from './crypto';
import type { ConnectorInstance } from './prisma';

export interface LoadedConnector {
  connector: AnyEveConnector;
  ctx: ConnectorContext<unknown, unknown>;
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Turns a database row into something a connector can be called with:
 * validated config, decrypted credentials, last sync timestamp.
 *
 * Throws on invalid config rather than falling back to defaults — a silently
 * wrong config would sync the wrong data, which is worse than a visible error
 * on the widget.
 */
export function loadConnectorContext(instance: ConnectorInstance): LoadedConnector {
  const connector = requireConnector(instance.connectorId);

  const configResult = connector.configSchema.safeParse(instance.config);
  if (!configResult.success) {
    const details = configResult.error.issues.map((i) => `${i.path.join('.') || 'config'}: ${i.message}`).join('; ');
    throw new Error(`Configuração inválida para o connector "${connector.id}": ${details}`);
  }

  let credentials: unknown;
  if (connector.credentialsSchema) {
    if (!instance.credentialsEnc) {
      throw new Error(`O connector "${connector.id}" exige credenciais, mas nenhuma foi salva nesta instancia.`);
    }
    const decrypted = decryptJson(instance.credentialsEnc, instance.credentialsKeyVersion);
    const credsResult = connector.credentialsSchema.safeParse(decrypted);
    if (!credsResult.success) {
      throw new Error(`Credenciais invalidas para o connector "${connector.id}".`);
    }
    credentials = credsResult.data;
  }

  return {
    connector,
    ctx: {
      instanceId: instance.id,
      config: configResult.data,
      credentials,
      lastSyncedAt: instance.lastSyncedAt,
    },
  };
}
