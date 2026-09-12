import { prisma } from '@eve/core';
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

  const row = await prisma.user.findUnique({ where: { id: user.id }, select: { isOwner: true, isSocialMedia: true } });
  if (!row) redirect('/login');
  if (!canViewScheduling(row)) redirect('/');

  return (
    <div className="eve-profile">
      <header className="eve-profile__header">
        <Link href="/" className="eve-btn eve-btn--icon" title={strings.profile.back}>
          <EveArch size={18} />
        </Link>
        <h1 className="eve-profile__title">{strings.nav.scheduling}</h1>
      </header>

      <SchedulingTabs />
    </div>
  );
}
