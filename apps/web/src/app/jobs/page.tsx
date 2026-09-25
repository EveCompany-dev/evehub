import { EveArch, strings } from '@eve/ui';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { JSX } from 'react';
import { JobsBoard } from '../../components/JobsBoard';
import { canViewTab } from '../../lib/permissions';
import { getSessionUser } from '../../lib/session';

export const dynamic = 'force-dynamic';

/** Every member unless their cargo hides the Jobs tab. */
export default async function JobsPage(): Promise<JSX.Element> {
  const user = await getSessionUser();
  if (!user) redirect('/login');
  if (!canViewTab(user, 'jobs')) redirect('/');

  return (
    <div className="eve-jobs-page">
      <header className="eve-jobs-page__header">
        <Link href="/" className="eve-btn eve-btn--icon" title={strings.profile.back}>
          <EveArch size={18} />
        </Link>
        <h1 className="eve-profile__title">{strings.jobs.title}</h1>
      </header>

      <JobsBoard currentUserId={user.id} isAdmin={user.isOwner} />
    </div>
  );
}
