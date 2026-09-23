import { prisma } from '@eve/core';
import { EveArch, strings } from '@eve/ui';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { JSX } from 'react';
import { ConnectorsWorkspace } from '../../components/ConnectorsWorkspace';
import { canViewTab } from '../../lib/permissions';
import { getSessionUser } from '../../lib/session';

export const dynamic = 'force-dynamic';

/** Every connector type and the workspace's current instances of each, in one reachable place. */
export default async function ConnectorsPage(): Promise<JSX.Element> {
  const user = await getSessionUser();
  if (!user) redirect('/login');
  if (!canViewTab(user, 'connectors')) redirect('/');

  const row = await prisma.user.findUnique({ where: { id: user.id }, select: { isOwner: true } });
  if (!row) redirect('/login');

  return (
    <div className="eve-wide-page">
      <header className="eve-wide-page__header">
        <Link href="/" className="eve-btn eve-btn--icon" title={strings.profile.back}>
          <EveArch size={18} />
        </Link>
        <h1 className="eve-profile__title">{strings.nav.connectors}</h1>
      </header>
      <div className="eve-wide-page__body">
        <ConnectorsWorkspace isOwner={row.isOwner} />
      </div>
    </div>
  );
}
