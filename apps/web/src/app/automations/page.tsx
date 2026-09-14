import { prisma } from '@eve/core';
import { EveArch, strings } from '@eve/ui';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { JSX } from 'react';
import { AutomationsWorkspace } from '../../components/AutomationsWorkspace';
import { getSessionUser } from '../../lib/session';

export const dynamic = 'force-dynamic';

/**
 * The AutomationLog model already existed (n8n webhook target, see
 * infra/prisma/schema.prisma) — this wires up the ingestion endpoint
 * (owner-managed token) and a read-only activity feed. Open to any
 * authenticated user to view; only an owner can (re)generate the token.
 */
export default async function AutomationsPage(): Promise<JSX.Element> {
  const user = await getSessionUser();
  if (!user) redirect('/login');

  const row = await prisma.user.findUnique({ where: { id: user.id }, select: { isOwner: true } });
  if (!row) redirect('/login');

  return (
    <div className="eve-wide-page">
      <header className="eve-wide-page__header">
        <Link href="/" className="eve-btn eve-btn--icon" title={strings.profile.back}>
          <EveArch size={18} />
        </Link>
        <h1 className="eve-profile__title">{strings.automations.title}</h1>
      </header>
      <div className="eve-wide-page__body">
        <AutomationsWorkspace isOwner={row.isOwner} />
      </div>
    </div>
  );
}
