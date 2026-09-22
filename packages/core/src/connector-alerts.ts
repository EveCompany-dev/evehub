import { prisma } from './prisma';

export type ConnectorAlert = 'failed' | 'recovered';

/**
 * Whether this sync is worth telling somebody about.
 *
 * Only transitions count. A connector with a revoked token fails every five
 * minutes, and a notification per tick would train everyone to ignore the
 * bell — the news is that it broke, and later that it came back.
 *
 * `syncing` as the previous status means an earlier run never finished (the
 * process died mid-sync), so it is treated as "was not failing": the first
 * failure after it is still news.
 */
export function connectorAlertFor(previousStatus: string, syncSucceeded: boolean): ConnectorAlert | null {
  if (syncSucceeded) return previousStatus === 'error' ? 'recovered' : null;
  return previousStatus === 'error' ? null : 'failed';
}

export function connectorAlertMessage(alert: ConnectorAlert, label: string, detail?: string): string {
  if (alert === 'recovered') return `O conector “${label}” voltou a sincronizar.`;
  return detail ? `O conector “${label}” parou de sincronizar: ${detail}` : `O conector “${label}” parou de sincronizar.`;
}

/**
 * Tells the workspace's owners, because they are the only ones who can fix it:
 * credentials are owner-only by design (see lib/permissions.ts). Returns how
 * many people were told, which is 0 for a workspace with no owner — a seeded
 * workspace always has one.
 */
export async function raiseConnectorAlert(params: {
  workspaceId: string;
  label: string;
  alert: ConnectorAlert;
  detail?: string;
}): Promise<number> {
  const owners = await prisma.user.findMany({ where: { workspaceId: params.workspaceId, isOwner: true }, select: { id: true } });
  if (owners.length === 0) return 0;

  const message = connectorAlertMessage(params.alert, params.label, params.detail).slice(0, 500);
  const type = params.alert === 'failed' ? 'connectorSyncFailed' : 'connectorSyncRecovered';

  await prisma.notification.createMany({
    data: owners.map((owner) => ({ workspaceId: params.workspaceId, userId: owner.id, type, message })),
  });

  return owners.length;
}
