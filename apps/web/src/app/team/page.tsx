import { EveArch, strings } from '@eve/ui';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { JSX } from 'react';
import { JobColumnsSection } from '../../components/JobColumnsSection';
import { canManageJobColumnColors, canViewTeamTab } from '../../lib/permissions';
import { getSessionUser } from '../../lib/session';
import { TeamSection } from '../perfil/TeamSection';

export const dynamic = 'force-dynamic';

/**
 * Admins (the fixed e-mail list) get full management; everyone else gets the
 * read-only roster, since 'team' is a default tab (see canManageTeam). The
 * settings that apply to the whole team live here too, not in Configuracoes,
 * which is only personal preferences.
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

      {canManageJobColumnColors(user) && (
        <section className="eve-card">
          <JobColumnsSection />
        </section>
      )}
    </div>
  );
}
