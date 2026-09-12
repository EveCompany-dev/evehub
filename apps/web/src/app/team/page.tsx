import { prisma } from '@eve/core';
import { EveArch, strings } from '@eve/ui';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { JSX } from 'react';
import { canManageTeam } from '../../lib/permissions';
import { getSessionUser } from '../../lib/session';
import { TeamSection } from '../perfil/TeamSection';

export const dynamic = 'force-dynamic';

export default async function TeamPage(): Promise<JSX.Element> {
  const user = await getSessionUser();
  if (!user) redirect('/login');

  const row = await prisma.user.findUnique({ where: { id: user.id }, select: { id: true, isOwner: true } });
  if (!row) redirect('/login');
  if (!canManageTeam(row)) redirect('/');

  return (
    <div className="eve-profile">
      <header className="eve-profile__header">
        <Link href="/" className="eve-btn eve-btn--icon" title={strings.profile.back}>
          <EveArch size={18} />
        </Link>
        <h1 className="eve-profile__title">{strings.nav.team}</h1>
      </header>

      <TeamSection currentUserId={row.id} />
    </div>
  );
}
