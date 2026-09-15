import { beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { ConnectorContractError, getConnector, listConnectors, registerConnector, requireConnector, resetRegistryForTests } from './index';
import type { EveConnector } from './types';

function baseConnector(overrides: Partial<EveConnector<{ n: number }>> = {}): EveConnector<{ n: number }> {
  return {
    id: 'test',
    label: 'Test',
    category: 'external',
    auth: 'none',
    capabilities: { read: true, write: false, webhook: false },
    configSchema: z.object({ n: z.number() }),
    defaultConfig: { n: 1 },
    sync: async () => ({ ok: true, data: null }),
    ...overrides,
  };
}

describe('connector registry', () => {
  beforeEach(() => {
    resetRegistryForTests();
  });

  it('registers and retrieves a connector', () => {
    registerConnector(baseConnector());
    expect(getConnector('test')?.label).toBe('Test');
    expect(listConnectors()).toHaveLength(1);
  });

  it('throws a helpful error for an unknown connector', () => {
    expect(() => requireConnector('nope')).toThrow(ConnectorContractError);
  });

  it('rejects a connector that declares write without implementing it', () => {
    expect(() =>
      registerConnector(baseConnector({ capabilities: { read: true, write: true, webhook: false } })),
    ).toThrow(/no write\(\)/);
  });

  it('rejects a writable connector without readVersion, because undo depends on it', () => {
    expect(() =>
      registerConnector(
        baseConnector({
          capabilities: { read: true, write: true, webhook: false },
          write: async () => ({ ok: true, newVersion: '1', data: {} }),
        }),
      ),
    ).toThrow(/readVersion/);
  });

  it('rejects a connector that needs auth but declares no credentials schema', () => {
    expect(() => registerConnector(baseConnector({ auth: 'token' }))).toThrow(/credentialsSchema/);
  });

  it('tolerates re-registering the identical instance (hot reload)', () => {
    const connector = baseConnector();
    registerConnector(connector);
    expect(() => registerConnector(connector)).not.toThrow();
    expect(listConnectors()).toHaveLength(1);
  });

  it('accepts a duplicate module instance declaring the same connector', () => {
    // Next.js evaluates the connector module once per bundle chunk, so two
    // distinct objects legitimately describe the same connector.
    const first = registerConnector(baseConnector());
    const second = registerConnector(baseConnector());

    expect(second).toBe(first);
    expect(listConnectors()).toHaveLength(1);
  });

  it('rejects two genuinely different connectors claiming the same id', () => {
    registerConnector(baseConnector());
    expect(() => registerConnector(baseConnector({ label: 'Outro' }))).toThrow(/already registered/);
  });
});
