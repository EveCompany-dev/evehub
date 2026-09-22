import { EveArch, strings } from '@eve/ui';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { JSX } from 'react';
import { ChatTabs } from '../../components/ChatTabs';
import { canViewTab } from '../../lib/permissions';
import { getSessionUser } from '../../lib/session';

export const dynamic = 'force-dynamic';

/** Team chat (one shared room) and Private (1:1 DMs) live behind a tab switcher here — see ChatTabs. */
export default async function ChatPage(): Promise<JSX.Element> {
  const user = await getSessionUser();
  if (!user) redirect('/login');
  if (!canViewTab(user, 'chat')) redirect('/');

  return (
    <div className="eve-wide-page">
      <header className="eve-wide-page__header">
        <Link href="/" className="eve-btn eve-btn--icon" title={strings.profile.back}>
          <EveArch size={18} />
        </Link>
        <h1 className="eve-profile__title">{strings.nav.chat}</h1>
      </header>
      <div className="eve-wide-page__body">
        <ChatTabs currentUserId={user.id} />
      </div>
    </div>
  );
}
