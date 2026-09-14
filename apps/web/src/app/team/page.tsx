import { EveArch, strings } from '@eve/ui';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { JSX } from 'react';
import { canViewTeamTab } from '../../lib/permissions';
import { getSessionUser } from '../../lib/session';
import { TeamSection } from '../perfil/TeamSection';

export const dynamic = 'force-dynamic';

/**
 * Owner gets full management; a Role granting the 'team' tab gets a
 * read-only roster (see canManageTeam — mutations stay owner-only always).
 */
export default async function TeamPage(): Promise<JSX.Element> {
  const user = await getSessionUser();
  if (!user) redirect('/login');
  if (!canViewTeamTab(user)) redirect('/');

  return (
    <div className="eve-profile">
      <header className="eve-profile__header">
        <Link href="/" className="eve-btn eve-btn--icon" title={strings.profile.back}>
          <EveArch size={18} />
        </Link>
        <h1 className="eve-profile__title">{strings.nav.team}</h1>
      </header>

      <TeamSection currentUserId={user.id} isOwner={user.isOwner} />
    </div>
  );
}
