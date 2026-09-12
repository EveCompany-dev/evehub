import { prisma } from '@eve/core';
import { strings } from '@eve/ui';
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
    <div className="eve-empty">
      <h1 className="eve-empty__title">{strings.financial.title}</h1>
      <p className="eve-dim">{strings.financial.empty}</p>
      <p className="eve-dim">{strings.financial.emptyHint}</p>
    </div>
  );
}
