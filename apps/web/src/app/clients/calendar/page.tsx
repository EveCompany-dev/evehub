import { EveArch, strings } from '@eve/ui';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { JSX } from 'react';
import { ContentCalendarWorkspace } from '../../../components/ContentCalendarWorkspace';
import { canViewTab } from '../../../lib/permissions';
import { getSessionUser } from '../../../lib/session';

export const dynamic = 'force-dynamic';

export default async function ContentCalendarPage(): Promise<JSX.Element> {
  const user = await getSessionUser();
  if (!user) redirect('/login');
  if (!canViewTab(user, 'scheduling')) redirect('/');

  return (
    <div className="eve-wide-page">
      <header className="eve-wide-page__header">
        <Link href="/" className="eve-btn eve-btn--icon" title={strings.profile.back}>
          <EveArch size={18} />
        </Link>
        <h1 className="eve-profile__title">Calendário de Conteúdo</h1>
      </header>
      <div className="eve-wide-page__body">
        <ContentCalendarWorkspace />
      </div>
    </div>
  );
}
