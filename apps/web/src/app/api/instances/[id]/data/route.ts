import { autoDetectFields, type RemoteRecord } from '@eve/connector-sdk';
import { listUndoableEdits, prisma } from '@eve/core';
import { requireConnector } from '../../../../../connectors';
import { handle, ok } from '../../../../../lib/api';
import { requireInstance, requireUser } from '../../../../../lib/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Everything a widget needs for one render: instance health, snapshot, records, undo queue. */
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const user = await requireUser();
    const { id } = await context.params;
    const instance = await requireInstance(id, user);

    const connector = requireConnector(instance.connectorId);

    const [snapshot, records, undoableEdits] = await Promise.all([
      instance.latestSnapshotId
        ? prisma.syncSnapshot.findUnique({ where: { id: instance.latestSnapshotId } })
        : Promise.resolve(null),
      prisma.syncRecord.findMany({
        where: { connectorInstanceId: instance.id },
        orderBy: { remoteId: 'asc' },
        select: { remoteId: true, remoteVersion: true, data: true },
      }),
      listUndoableEdits(instance.id),
    ]);

    // Generic field schema for the widget rendering layer: a connector that
    // declares describeFields() gets exact columns/types; one that doesn't
    // still renders through the generic engine via auto-detection.
    const fields = connector.describeFields
      ? connector.describeFields(snapshot?.data ?? null)
      : autoDetectFields(records as RemoteRecord[]);

    return ok({
      instance: {
        id: instance.id,
        connectorId: instance.connectorId,
        label: instance.label,
        status: instance.status,
        statusMessage: instance.statusMessage,
        lastSyncedAt: instance.lastSyncedAt?.toISOString() ?? null,
        capabilities: connector.capabilities,
      },
      snapshot: snapshot ? { data: snapshot.data, syncedAt: snapshot.syncedAt.toISOString() } : null,
      records,
      fields,
      undoableEdits,
    });
  });
}
