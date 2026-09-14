import { EveArch, strings } from '@eve/ui';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { JSX } from 'react';
import { TablesWorkspace } from '../../components/TablesWorkspace';
import { getSessionUser } from '../../lib/session';

export const dynamic = 'force-dynamic';

/** Open to any authenticated workspace member — no permission tag, same as Automations. */
export default async function TablesPage(): Promise<JSX.Element> {
  const user = await getSessionUser();
  if (!user) redirect('/login');

  return (
    <div className="eve-wide-page">
      <header className="eve-wide-page__header">
        <Link href="/" className="eve-btn eve-btn--icon" title={strings.profile.back}>
          <EveArch size={18} />
        </Link>
        <h1 className="eve-profile__title">{strings.nav.tables}</h1>
      </header>

      <div className="eve-wide-page__body">
        <TablesWorkspace />
      </div>
    </div>
  );
}
