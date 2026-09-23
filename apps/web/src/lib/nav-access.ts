import { prisma } from '@eve/core';
import { listConnectors } from '../connectors';
import type { NavFeature } from './navigation';
import { getVisibleTabs, type TabSubject } from './permissions';

/** Connectors that are a calendar the Agenda do Time can show (Google Agenda today). */
export function calendarConnectorIds(): string[] {
  return listConnectors()
    .filter((connector) => connector.calendar)
    .map((connector) => connector.id);
}

/** Whether the workspace has a calendar connected — without one there is no Agenda do Time to open. */
export async function hasCalendarConnection(workspaceId: string): Promise<boolean> {
  const count = await prisma.connectorInstance.count({
    where: { workspaceId, connectorId: { in: calendarConnectorIds() }, status: { not: 'disabled' } },
  });
  return count > 0;
}

/**
 * What the rail, Ctrl+K and the start-page picker are filtered by: the tabs
 * this person may open, plus the workspace features that are on.
 */
export async function navKeys(user: TabSubject, workspaceId: string): Promise<string[]> {
  const tabs: string[] = [...getVisibleTabs(user)];
  const features: NavFeature[] = tabs.includes('scheduling') && (await hasCalendarConnection(workspaceId)) ? ['calendar'] : [];
  return [...tabs, ...features];
}
