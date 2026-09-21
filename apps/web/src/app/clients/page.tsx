import { EveArch, strings } from '@eve/ui';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { JSX } from 'react';
import { ClientsPanel } from '../../components/ClientsPanel';
import { getSessionUser } from '../../lib/session';

export const dynamic = 'force-dynamic';

/** Every client as a brand card. Open to any authenticated workspace member, like the client pages themselves. */
export default async function ClientsPage(): Promise<JSX.Element> {
  const user = await getSessionUser();
  if (!user) redirect('/login');

  return (
    <div className="eve-wide-page">
      <header className="eve-wide-page__header">
        <Link href="/" className="eve-btn eve-btn--icon" title={strings.profile.back}>
          <EveArch size={18} />
        </Link>
        <h1 className="eve-profile__title">Clientes</h1>
      </header>
      <div className="eve-wide-page__body">
        <ClientsPanel />
      </div>
    </div>
  );
}
