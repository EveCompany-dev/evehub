import { EveArch, strings } from '@eve/ui';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { JSX } from 'react';
import { TeamChatWorkspace } from '../../components/TeamChatWorkspace';
import { getSessionUser } from '../../lib/session';

export const dynamic = 'force-dynamic';

/** Workspace-wide chat — every authenticated user is in the same one room, no channels/DMs yet. */
export default async function ChatPage(): Promise<JSX.Element> {
  const user = await getSessionUser();
  if (!user) redirect('/login');

  return (
    <div className="eve-wide-page">
      <header className="eve-wide-page__header">
        <Link href="/" className="eve-btn eve-btn--icon" title={strings.profile.back}>
          <EveArch size={18} />
        </Link>
        <h1 className="eve-profile__title">{strings.nav.chat}</h1>
      </header>
      <div className="eve-wide-page__body">
        <TeamChatWorkspace currentUserId={user.id} />
      </div>
    </div>
  );
}
