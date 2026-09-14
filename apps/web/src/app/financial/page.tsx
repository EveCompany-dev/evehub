import { EveArch, strings } from '@eve/ui';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { JSX } from 'react';
import { FinancialWorkspace } from '../../components/FinancialWorkspace';
import { canViewFinancial } from '../../lib/permissions';
import { getSessionUser } from '../../lib/session';

export const dynamic = 'force-dynamic';

/** Owner sees this by default; a Role can also grant the 'financial' tab to a non-owner. */
export default async function FinancialPage(): Promise<JSX.Element> {
  const user = await getSessionUser();
  if (!user) redirect('/login');
  if (!canViewFinancial(user)) redirect('/');

  return (
    <div className="eve-wide-page">
      <header className="eve-wide-page__header">
        <Link href="/" className="eve-btn eve-btn--icon" title={strings.profile.back}>
          <EveArch size={18} />
        </Link>
        <h1 className="eve-profile__title">{strings.financial.title}</h1>
      </header>
      <div className="eve-wide-page__body">
        <FinancialWorkspace />
      </div>
    </div>
  );
}
