import { strings } from '@eve/ui';
import { redirect } from 'next/navigation';
import type { JSX } from 'react';
import { getSessionUser } from '../../lib/session';

export const dynamic = 'force-dynamic';

/**
 * Scaffold only: the AutomationLog model already exists (n8n webhook target,
 * see infra/prisma/schema.prisma), but no ingestion route is wired up yet.
 * This page ships the tab and empty state ahead of that integration.
 */
export default async function AutomationsPage(): Promise<JSX.Element> {
  const user = await getSessionUser();
  if (!user) redirect('/login');

  return (
    <div className="eve-empty">
      <h1 className="eve-empty__title">{strings.automations.title}</h1>
      <p className="eve-dim">{strings.automations.empty}</p>
      <p className="eve-dim">{strings.automations.emptyHint}</p>
    </div>
  );
}
