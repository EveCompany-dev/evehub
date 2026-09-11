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
      undoableEdits,
    });
  });
}
