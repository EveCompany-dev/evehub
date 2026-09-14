import { EveArch, strings } from '@eve/ui';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { JSX } from 'react';
import { NotificationsWorkspace } from '../../components/NotificationsWorkspace';
import { getSessionUser } from '../../lib/session';

export const dynamic = 'force-dynamic';

/** The bell in the rail only shows the last 30 — this is the full history. */
export default async function NotificationsPage(): Promise<JSX.Element> {
  const user = await getSessionUser();
  if (!user) redirect('/login');

  return (
    <div className="eve-wide-page">
      <header className="eve-wide-page__header">
        <Link href="/" className="eve-btn eve-btn--icon" title={strings.profile.back}>
          <EveArch size={18} />
        </Link>
        <h1 className="eve-profile__title">{strings.notifications.title}</h1>
      </header>
      <div className="eve-wide-page__body">
        <NotificationsWorkspace />
      </div>
    </div>
  );
}
