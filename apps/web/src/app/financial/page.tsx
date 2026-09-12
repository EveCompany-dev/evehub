import { prisma } from '@eve/core';
import { EveArch, strings } from '@eve/ui';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { JSX } from 'react';
import { canViewFinancial } from '../../lib/permissions';
import { getSessionUser } from '../../lib/session';

export const dynamic = 'force-dynamic';

/** Scaffold only: no financial data source is wired up yet. Owner-only by default. */
export default async function FinancialPage(): Promise<JSX.Element> {
  const user = await getSessionUser();
  if (!user) redirect('/login');

  const row = await prisma.user.findUnique({ where: { id: user.id }, select: { isOwner: true } });
  if (!row) redirect('/login');
  if (!canViewFinancial(row)) redirect('/');

  return (
    <div className="eve-profile">
      <header className="eve-profile__header">
        <Link href="/" className="eve-btn eve-btn--icon" title={strings.profile.back}>
          <EveArch size={18} />
        </Link>
        <h1 className="eve-profile__title">{strings.financial.title}</h1>
      </header>

      <div className="eve-empty">
        <p className="eve-dim">{strings.financial.empty}</p>
        <p className="eve-dim">{strings.financial.emptyHint}</p>
      </div>
    </div>
  );
}
