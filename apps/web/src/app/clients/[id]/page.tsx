import { EveArch } from '@eve/ui';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { JSX } from 'react';
import { ClientDetailWorkspace } from '../../../components/ClientDetailWorkspace';
import { canViewTab } from '../../../lib/permissions';
import { getSessionUser } from '../../../lib/session';

export const dynamic = 'force-dynamic';

/** Open to any authenticated workspace member — same as Jobs, which is where this page is linked from. */
export default async function ClientPage({ params }: { params: Promise<{ id: string }> }): Promise<JSX.Element> {
  const user = await getSessionUser();
  if (!user) redirect('/login');
  if (!canViewTab(user, 'tables')) redirect('/');
  const { id } = await params;

  return (
    <div className="eve-wide-page">
      <header className="eve-wide-page__header">
        <Link href="/clients" className="eve-btn eve-btn--icon" title="Voltar para Clientes">
          <EveArch size={18} />
        </Link>
        <h1 className="eve-profile__title">Cliente</h1>
      </header>
      <div className="eve-wide-page__body">
        <ClientDetailWorkspace clientId={id} />
      </div>
    </div>
  );
}
