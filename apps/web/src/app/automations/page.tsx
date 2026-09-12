import { EveArch, strings } from '@eve/ui';
import Link from 'next/link';
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
    <div className="eve-profile">
      <header className="eve-profile__header">
        <Link href="/" className="eve-btn eve-btn--icon" title={strings.profile.back}>
          <EveArch size={18} />
        </Link>
        <h1 className="eve-profile__title">{strings.automations.title}</h1>
      </header>

      <div className="eve-empty">
        <p className="eve-dim">{strings.automations.empty}</p>
        <p className="eve-dim">{strings.automations.emptyHint}</p>
      </div>
    </div>
  );
}
