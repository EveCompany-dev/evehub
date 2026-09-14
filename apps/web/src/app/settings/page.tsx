import { EveArch } from '@eve/ui';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { JSX } from 'react';
import { SettingsWorkspace } from '../../components/SettingsWorkspace';
import { getSessionUser } from '../../lib/session';

export const dynamic = 'force-dynamic';

/** Open to any authenticated workspace member — it edits their own dashboardConfig row, same as the rail's gear popover. */
export default async function SettingsPage(): Promise<JSX.Element> {
  const user = await getSessionUser();
  if (!user) redirect('/login');

  return (
    <div className="eve-wide-page">
      <header className="eve-wide-page__header">
        <Link href="/" className="eve-btn eve-btn--icon" title="Voltar">
          <EveArch size={18} />
        </Link>
        <h1 className="eve-profile__title">Configurações</h1>
      </header>

      <div className="eve-wide-page__body">
        <SettingsWorkspace />
      </div>
    </div>
  );
}
