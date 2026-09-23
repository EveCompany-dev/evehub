import { EveArch, strings } from '@eve/ui';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { JSX } from 'react';
import { TablesWorkspace } from '../../components/TablesWorkspace';
import { canViewTab } from '../../lib/permissions';
import { getSessionUser } from '../../lib/session';

export const dynamic = 'force-dynamic';

/** Every member unless their cargo hides the Tabelas tab. */
export default async function TablesPage({
  searchParams,
}: {
  searchParams: Promise<{ table?: string }>;
}): Promise<JSX.Element> {
  const user = await getSessionUser();
  if (!user) redirect('/login');
  if (!canViewTab(user, 'tables')) redirect('/');
  const { table } = await searchParams;

  return (
    <div className="eve-wide-page">
      <header className="eve-wide-page__header">
        <Link href="/" className="eve-btn eve-btn--icon" title={strings.profile.back}>
          <EveArch size={18} />
        </Link>
        <h1 className="eve-profile__title">{strings.nav.tables}</h1>
      </header>

      <div className="eve-wide-page__body">
        <TablesWorkspace initialTableId={table} />
      </div>
    </div>
  );
}
