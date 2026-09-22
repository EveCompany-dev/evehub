import type { SyncResult } from '@eve/connector-sdk';
import { connectorAlertFor, raiseConnectorAlert } from './connector-alerts';
import { errorMessage, loadConnectorContext } from './connector-context';
import { publishConnectorEvent } from './events';
import { Prisma, prisma } from './prisma';

export interface SyncOutcome {
  ok: boolean;
  error?: string;
  recordCount?: number;
}

function toJsonInput(value: unknown): Prisma.InputJsonValue {
  return (value === undefined || value === null ? Prisma.JsonNull : value) as Prisma.InputJsonValue;
}

/**
 * Tells the owners when an integration breaks, and again when it comes back.
 * `instance` is the row as it was *before* this run, so the status on it is
 * the one to compare against.
 */
async function alertOnStatusChange(
  instance: { id: string; workspaceId: string; label: string; status: string },
  syncSucceeded: boolean,
  detail?: string,
): Promise<void> {
  const alert = connectorAlertFor(instance.status, syncSucceeded);
  if (!alert) return;

  try {
    await raiseConnectorAlert({
      workspaceId: instance.workspaceId,
      label: instance.label,
      alert,
      ...(detail ? { detail } : {}),
    });
  } catch (error) {
    // The sync's own result is what must survive; a missed notification is not
    // worth turning a good sync into a failed one.
    console.error(`[sync] falha ao avisar sobre o conector ${instance.id}:`, errorMessage(error));
  }
}

/**
 * Runs one sync for one connector instance and persists the result.
 *
 * Every failure mode ends with the instance in `error` plus a human-readable
 * `statusMessage`, which the widget header renders directly. A broken
 * connector reports itself instead of failing silently — that is the whole
 * point of "falha isolada".
 */
export async function runSync(instanceId: string): Promise<SyncOutcome> {
  const instance = await prisma.connectorInstance.findUnique({ where: { id: instanceId } });

  if (!instance) return { ok: false, error: `Instância ${instanceId} não existe.` };
  if (instance.status === 'disabled') return { ok: false, error: 'Instancia desativada.' };

  await prisma.connectorInstance.update({ where: { id: instanceId }, data: { status: 'syncing' } });

  let result: SyncResult;
  try {
    const { connector, ctx } = loadConnectorContext(instance);
    if (!connector.capabilities.read) {
      throw new Error(`O connector "${connector.id}" não declara capacidade de leitura.`);
    }
    result = await connector.sync(ctx);
  } catch (error) {
    result = { ok: false, error: errorMessage(error) };
  }

  if (!result.ok) {
    const message = result.error.slice(0, 500);
    await prisma.connectorInstance.update({
      where: { id: instanceId },
      data: { status: 'error', statusMessage: message },
    });
    await publishConnectorEvent({
      type: 'connector:updated',
      workspaceId: instance.workspaceId,
      instanceId,
      connectorId: instance.connectorId,
      status: 'error',
      syncedAt: new Date().toISOString(),
    });
    await alertOnStatusChange(instance, false, message);
    return { ok: false, error: message };
  }

  const syncedAt = new Date();
  const records = result.records ?? [];

  await prisma.$transaction(async (tx) => {
    const snapshot = await tx.syncSnapshot.create({
      data: { connectorInstanceId: instanceId, data: toJsonInput(result.ok ? result.data : null), syncedAt },
    });

    if (result.ok && result.records) {
      for (const record of records) {
        await tx.syncRecord.upsert({
          where: { connectorInstanceId_remoteId: { connectorInstanceId: instanceId, remoteId: record.remoteId } },
          create: {
            connectorInstanceId: instanceId,
            remoteId: record.remoteId,
            remoteVersion: record.remoteVersion,
            data: toJsonInput(record.data),
            syncedAt,
          },
          update: {
            remoteVersion: record.remoteVersion,
            data: toJsonInput(record.data),
            syncedAt,
          },
        });
      }

      // Records that disappeared upstream must disappear locally too, or the
      // widget keeps showing rows that no longer exist.
      await tx.syncRecord.deleteMany({
        where: { connectorInstanceId: instanceId, remoteId: { notIn: records.map((r) => r.remoteId) } },
      });
    }

    await tx.connectorInstance.update({
      where: { id: instanceId },
      data: { status: 'ok', statusMessage: null, lastSyncedAt: syncedAt, latestSnapshotId: snapshot.id },
    });
  });

  await publishConnectorEvent({
    type: 'connector:updated',
    workspaceId: instance.workspaceId,
    instanceId,
    connectorId: instance.connectorId,
    status: 'ok',
    syncedAt: syncedAt.toISOString(),
  });

  await alertOnStatusChange(instance, true);

  return { ok: true, recordCount: records.length };
}

/**
 * Drops snapshots older than the retention window, always keeping the one each
 * instance currently points at. Without this a single instance adds roughly
 * 8.600 rows a month forever.
 */
export async function pruneSnapshots(retentionDays: number): Promise<number> {
  const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);

  const pinned = await prisma.connectorInstance.findMany({
    where: { latestSnapshotId: { not: null } },
    select: { latestSnapshotId: true },
  });
  const keep = pinned.map((row) => row.latestSnapshotId).filter((id): id is string => id !== null);

  const { count } = await prisma.syncSnapshot.deleteMany({
    where: { syncedAt: { lt: cutoff }, id: { notIn: keep } },
  });

  return count;
}
