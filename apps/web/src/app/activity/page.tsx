import { EveArch, strings } from '@eve/ui';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { JSX } from 'react';
import { ActivityLogWorkspace } from '../../components/ActivityLogWorkspace';
import { canViewActivityLog } from '../../lib/permissions';
import { getSessionUser } from '../../lib/session';

export const dynamic = 'force-dynamic';

/** Tudo o que o time fez, para os admins. A API reavalia a permissao a cada pagina. */
export default async function ActivityPage(): Promise<JSX.Element> {
  const user = await getSessionUser();
  if (!user) redirect('/login');
  if (!canViewActivityLog(user)) redirect('/');

  return (
    <div className="eve-wide-page">
      <header className="eve-wide-page__header">
        <Link href="/" className="eve-btn eve-btn--icon" title={strings.profile.back}>
          <EveArch size={18} />
        </Link>
        <h1 className="eve-profile__title">Registro de atividades</h1>
      </header>
      <div className="eve-wide-page__body">
        <ActivityLogWorkspace />
      </div>
    </div>
  );
}
