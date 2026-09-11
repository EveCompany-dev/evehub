import type { ConnectorContext } from '@eve/connector-sdk';
import { beforeEach, describe, expect, it } from 'vitest';
import { demoConnector, type DemoConfig } from './connector';
import { createMemoryStore, setDemoStore } from './store';

const config: DemoConfig = { clientCount: 4, seed: 'test-seed' };

function ctx(instanceId = 'inst-1'): ConnectorContext<DemoConfig, undefined> {
  return { instanceId, config, credentials: undefined, lastSyncedAt: null };
}

async function firstRecord(instanceId = 'inst-1') {
  const result = await demoConnector.sync(ctx(instanceId));
  if (!result.ok) throw new Error(result.error);
  const record = result.records?.[0];
  if (!record) throw new Error('demo sync returned no records');
  return record;
}

describe('demo connector', () => {
  beforeEach(() => {
    setDemoStore(createMemoryStore());
  });

  it('declares a coherent contract', () => {
    expect(demoConnector.capabilities.write).toBe(true);
    expect(typeof demoConnector.write).toBe('function');
    expect(typeof demoConnector.readVersion).toBe('function');
  });

  it('produces the same records for the same seed', async () => {
    const a = await demoConnector.sync(ctx('a'));
    const b = await demoConnector.sync(ctx('b'));
    if (!a.ok || !b.ok) throw new Error('sync failed');

    expect(a.records).toHaveLength(4);
    expect(a.records?.map((r) => r.data.client)).toEqual(b.records?.map((r) => r.data.client));
  });

  it('changes volatile snapshot data without touching record versions', async () => {
    const first = await demoConnector.sync(ctx());
    const second = await demoConnector.sync(ctx());
    if (!first.ok || !second.ok) throw new Error('sync failed');

    expect(second.records?.map((r) => r.remoteVersion)).toEqual(first.records?.map((r) => r.remoteVersion));
    expect((second.data as { generatedAt: string }).generatedAt).toBeDefined();
  });

  it('applies a write and bumps the version', async () => {
    const record = await firstRecord();

    const result = await demoConnector.write?.(ctx(), {
      remoteId: record.remoteId,
      patch: { status: 'Pausado' },
      expectedVersion: record.remoteVersion,
    });

    expect(result).toMatchObject({ ok: true, newVersion: '2' });
    expect(await demoConnector.readVersion?.(ctx(), record.remoteId)).toBe('2');
  });

  it('rejects a stale write instead of overwriting it', async () => {
    const record = await firstRecord();
    const staleVersion = record.remoteVersion;

    await demoConnector.write?.(ctx(), {
      remoteId: record.remoteId,
      patch: { notes: 'primeira edicao' },
      expectedVersion: staleVersion,
    });

    const conflicted = await demoConnector.write?.(ctx(), {
      remoteId: record.remoteId,
      patch: { notes: 'edicao concorrente' },
      expectedVersion: staleVersion,
    });

    expect(conflicted).toMatchObject({ ok: false, conflict: true, currentVersion: '2' });

    // And the first edit survived untouched.
    const after = await demoConnector.sync(ctx());
    if (!after.ok) throw new Error('sync failed');
    expect(after.records?.find((r) => r.remoteId === record.remoteId)?.data.notes).toBe('primeira edicao');
  });

  it('refuses to write a read-only field', async () => {
    const record = await firstRecord();
    const result = await demoConnector.write?.(ctx(), {
      remoteId: record.remoteId,
      patch: { spend: '999' },
      expectedVersion: record.remoteVersion,
    });

    expect(result).toMatchObject({ ok: false });
    expect(result && 'error' in result ? result.error : '').toMatch(/somente leitura/);
  });

  it('refuses an invalid status', async () => {
    const record = await firstRecord();
    const result = await demoConnector.write?.(ctx(), {
      remoteId: record.remoteId,
      patch: { status: 'Nao existe' },
      expectedVersion: record.remoteVersion,
    });

    expect(result && 'error' in result ? result.error : '').toMatch(/Status invalido/);
  });

  it('returns null when asked for the version of a record that is gone', async () => {
    expect(await demoConnector.readVersion?.(ctx(), 'demo-999')).toBeNull();
  });

  it('validates its own config schema', () => {
    expect(demoConnector.configSchema.safeParse({ clientCount: 99, seed: 'x' }).success).toBe(false);
    expect(demoConnector.configSchema.safeParse(config).success).toBe(true);
  });
});
