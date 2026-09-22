import 'dotenv/config';
import { registerConnector } from '@eve/connector-sdk';
import { prisma, runSync } from '@eve/core';
import { z } from 'zod';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

/**
 * Integration test for the alerts the worker raises when an integration
 * breaks: the real runSync against the real Postgres, with a connector that
 * fails on command. Skips itself when no database answers, like the other
 * .db tests here.
 */

async function databaseUp(): Promise<boolean> {
  try {
    await prisma.$queryRaw`SELECT 1`;
    // Needs the migration that added the two notification types.
    await prisma.$queryRaw`SELECT 'connectorSyncFailed'::"NotificationType"`;
    return true;
  } catch {
    return false;
  }
}

const dbUp = await databaseUp();

/** Flipped by the tests; the connector reads it at sync time. */
const upstream = { healthy: true };

registerConnector({
  id: 'vitest-flaky',
  label: 'Conector de teste',
  category: 'local',
  auth: 'none',
  capabilities: { read: true, write: false, webhook: false },
  configSchema: z.object({}),
  defaultConfig: {},
  async sync() {
    return upstream.healthy ? { ok: true as const, data: { hello: 'world' }, records: [] } : { ok: false as const, error: 'Token revogado.' };
  },
});

describe.skipIf(!dbUp)('alerts when a connector stops syncing', () => {
  let workspaceId = '';
  let ownerId = '';
  let memberId = '';
  let instanceId = '';

  beforeAll(async () => {
    const workspace = await prisma.workspace.create({ data: { name: `vitest-alerts-${Date.now()}` } });
    workspaceId = workspace.id;

    const owner = await prisma.user.create({
      data: { workspaceId, email: `owner-${Date.now()}@vitest.local`, name: 'Dona', isOwner: true },
    });
    const member = await prisma.user.create({
      data: { workspaceId, email: `member-${Date.now()}@vitest.local`, name: 'Membro', isOwner: false },
    });
    ownerId = owner.id;
    memberId = member.id;

    const instance = await prisma.connectorInstance.create({
      data: { workspaceId, connectorId: 'vitest-flaky', label: 'Conector de teste', config: {} },
    });
    instanceId = instance.id;
  });

  afterAll(async () => {
    if (workspaceId) await prisma.workspace.delete({ where: { id: workspaceId } }).catch(() => undefined);
  });

  beforeEach(async () => {
    await prisma.notification.deleteMany({ where: { workspaceId } });
  });

  const notifications = () =>
    prisma.notification.findMany({ where: { workspaceId }, orderBy: { createdAt: 'asc' }, select: { userId: true, type: true, message: true } });

  it('says nothing while the connector is healthy', async () => {
    upstream.healthy = true;
    await expect(runSync(instanceId)).resolves.toMatchObject({ ok: true });
    expect(await notifications()).toEqual([]);
  });

  it('tells the owners the first time it breaks, and only the owners', async () => {
    upstream.healthy = false;
    await expect(runSync(instanceId)).resolves.toMatchObject({ ok: false, error: 'Token revogado.' });

    const raised = await notifications();
    expect(raised).toHaveLength(1);
    expect(raised[0]).toMatchObject({ userId: ownerId, type: 'connectorSyncFailed' });
    expect(raised[0]!.message).toBe('O conector “Conector de teste” parou de sincronizar: Token revogado.');
    expect(raised.some((row) => row.userId === memberId)).toBe(false);
  });

  it('stays quiet while it keeps failing, instead of one alert per tick', async () => {
    upstream.healthy = false;
    await runSync(instanceId);
    await runSync(instanceId);
    expect(await notifications()).toEqual([]);
  });

  it('closes the loop when the connector comes back', async () => {
    upstream.healthy = true;
    await expect(runSync(instanceId)).resolves.toMatchObject({ ok: true });

    const raised = await notifications();
    expect(raised).toHaveLength(1);
    expect(raised[0]).toMatchObject({ userId: ownerId, type: 'connectorSyncRecovered' });
    expect(raised[0]!.message).toBe('O conector “Conector de teste” voltou a sincronizar.');
  });

  it('does not repeat the recovery on the next healthy tick', async () => {
    upstream.healthy = true;
    await runSync(instanceId);
    expect(await notifications()).toEqual([]);
  });
});
