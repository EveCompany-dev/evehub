import { EveArch, strings } from '@eve/ui';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { JSX } from 'react';
import { SchedulingTabs } from '../../components/SchedulingTabs';
import { canViewScheduling } from '../../lib/permissions';
import { getSessionUser } from '../../lib/session';

export const dynamic = 'force-dynamic';

export default async function SchedulingPage(): Promise<JSX.Element> {
  const user = await getSessionUser();
  if (!user) redirect('/login');
  // getSessionUser() already reflects a fresh DB read (see auth.ts's session
  // callback) — no need for a second prisma.user.findUnique just for this check.
  if (!canViewScheduling(user)) redirect('/');

  return (
    <div className="eve-wide-page">
      <header className="eve-wide-page__header">
        <Link href="/" className="eve-btn eve-btn--icon" title={strings.profile.back}>
          <EveArch size={18} />
        </Link>
        <h1 className="eve-profile__title">{strings.nav.scheduling}</h1>
      </header>

      <div className="eve-wide-page__body">
        <SchedulingTabs />
      </div>
    </div>
  );
}
