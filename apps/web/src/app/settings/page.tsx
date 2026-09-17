import { prisma } from '@eve/core';
import { EveArch } from '@eve/ui';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { JSX } from 'react';
import { SettingsWorkspace } from '../../components/SettingsWorkspace';
import { getSessionUser } from '../../lib/session';

export const dynamic = 'force-dynamic';

/**
 * Open to any authenticated workspace member — most categories edit their
 * own dashboardConfig row, same as the rail's gear popover. `isOwner` is
 * fetched here (not just trusted from the session) so SettingsWorkspace can
 * hide the owner-only categories, like the Jobs status colors.
 */
export default async function SettingsPage(): Promise<JSX.Element> {
  const user = await getSessionUser();
  if (!user) redirect('/login');

  const row = await prisma.user.findUnique({ where: { id: user.id }, select: { isOwner: true } });
  if (!row) redirect('/login');

  return (
    <div className="eve-wide-page">
      <header className="eve-wide-page__header">
        <Link href="/" className="eve-btn eve-btn--icon" title="Voltar">
          <EveArch size={18} />
        </Link>
        <h1 className="eve-profile__title">Configurações</h1>
      </header>

      <div className="eve-wide-page__body">
        <SettingsWorkspace isOwner={row.isOwner} />
      </div>
    </div>
  );
}
