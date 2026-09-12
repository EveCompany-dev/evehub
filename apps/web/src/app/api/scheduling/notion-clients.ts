import { autoDetectFields, type RemoteRecord } from '@eve/connector-sdk';
import { prisma } from '@eve/core';
import { requireConnector } from '../../../connectors';

export interface NotionClientOption {
  source: 'notion';
  id: string;
  label: string;
}

/**
 * Reuses the exact field-schema resolution the generic widget engine already
 * has (apps/web/src/app/api/instances/[id]/data/route.ts): whatever the
 * connector's own describeFields() reports, falling back to auto-detection.
 * The first field is the label — title-first by construction for Notion.
 */
export async function listNotionClients(workspaceId: string): Promise<NotionClientOption[]> {
  const workspace = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    select: { clientSourceInstanceId: true },
  });
  const instanceId = workspace?.clientSourceInstanceId;
  if (!instanceId) return [];

  const instance = await prisma.connectorInstance.findUnique({ where: { id: instanceId } });
  if (!instance || instance.workspaceId !== workspaceId) return [];

  const [snapshot, records] = await Promise.all([
    instance.latestSnapshotId
      ? prisma.syncSnapshot.findUnique({ where: { id: instance.latestSnapshotId } })
      : Promise.resolve(null),
    prisma.syncRecord.findMany({
      where: { connectorInstanceId: instance.id },
      select: { remoteId: true, data: true },
    }),
  ]);

  const connector = requireConnector(instance.connectorId);
  const remoteRecords: RemoteRecord[] = records.map((record) => ({
    remoteId: record.remoteId,
    remoteVersion: '',
    data: record.data as Record<string, unknown>,
  }));

  const fields = connector.describeFields
    ? connector.describeFields(snapshot?.data ?? null)
    : autoDetectFields(remoteRecords);
  const labelKey = fields[0]?.key;

  return remoteRecords.map((record) => ({
    source: 'notion',
    id: record.remoteId,
    label: labelKey ? String(record.data[labelKey] ?? record.remoteId) : record.remoteId,
  }));
}
