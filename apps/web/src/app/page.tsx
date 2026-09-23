import { parseDashboardConfig, prisma } from '@eve/core';
import { redirect } from 'next/navigation';
import type { JSX } from 'react';
import { listConnectors } from '../connectors';
import { DashboardShell, type AvailableConnector } from '../components/DashboardShell';
import { DefaultPageRedirect } from '../components/DefaultPageRedirect';
import { resolveLandingPage } from '../lib/navigation';
import { navKeys } from '../lib/nav-access';
import { canCreateInstance } from '../lib/permissions';
import { getSessionUser } from '../lib/session';

export const dynamic = 'force-dynamic';

/**
 * The dashboard. Auth is enforced here rather than in middleware: the guard
 * runs in the Node runtime with full database access, so there is no separate
 * edge-compatible copy of the session logic to keep in sync.
 */
export default async function DashboardPage(): Promise<JSX.Element> {
  const user = await getSessionUser();
  if (!user) redirect('/login');

  const [row, instances] = await Promise.all([
    prisma.user.findUnique({ where: { id: user.id }, select: { dashboardConfig: true } }),
    prisma.connectorInstance.findMany({
      where: { workspaceId: user.workspaceId },
      orderBy: { createdAt: 'asc' },
      select: { id: true, connectorId: true, label: true },
    }),
  ]);

  const available: AvailableConnector[] = listConnectors().map((connector) => ({
    id: connector.id,
    label: connector.label,
    description: connector.description ?? null,
    defaultSize: connector.defaultSize ?? { w: 6, h: 6 },
    canCreate: canCreateInstance(user, connector.auth),
    needsCredentials: connector.auth !== 'none',
    category: connector.category,
  }));

  const config = parseDashboardConfig(row?.dashboardConfig);
  const keys = await navKeys(user, user.workspaceId);
  const landing = resolveLandingPage(config.defaultPage, keys);

  return (
    <>
      {landing && <DefaultPageRedirect target={landing} />}
      <DashboardShell
      userName={user.name ?? user.email}
      userEmail={user.email}
      userImage={user.image}
      isOwner={user.isOwner}
      initialConfig={config}
      initialInstances={instances}
      available={available}
      visibleTabs={keys}
    />
    </>
  );
}
