import { EveArch, strings } from '@eve/ui';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { JSX } from 'react';
import { AgendaWorkspace } from '../../components/AgendaWorkspace';
import { canViewScheduling } from '../../lib/permissions';
import { getSessionUser } from '../../lib/session';

export const dynamic = 'force-dynamic';

/**
 * The Agenda do Time (see AgendaWorkspace) — gated by the same tab as the
 * Calendário de Conteúdo and Agendar Post: they're the same feature area.
 */
export default async function AgendaPage(): Promise<JSX.Element> {
  const user = await getSessionUser();
  if (!user) redirect('/login');
  if (!canViewScheduling(user)) redirect('/');

  return (
    <div className="eve-wide-page">
      <header className="eve-wide-page__header">
        <Link href="/" className="eve-btn eve-btn--icon" title={strings.profile.back}>
          <EveArch size={18} />
        </Link>
        <h1 className="eve-profile__title">Agenda do Time</h1>
      </header>

      <div className="eve-wide-page__body">
        <AgendaWorkspace currentUserId={user.id} />
      </div>
    </div>
  );
}
