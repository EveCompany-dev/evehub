import { EveArch, strings } from '@eve/ui';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { JSX } from 'react';
import { PostComposer } from '../../components/PostComposer';
import { canViewScheduling } from '../../lib/permissions';
import { getSessionUser } from '../../lib/session';

export const dynamic = 'force-dynamic';

/**
 * Agendar Post — the post editor as its own page. ?row=<id> schedules a
 * Calendário de Conteúdo row ("Agendar post" on the row); ?post=<id> opens
 * a post already scheduled.
 */
export default async function SchedulingPage({ searchParams }: { searchParams: Promise<{ post?: string; row?: string }> }): Promise<JSX.Element> {
  const user = await getSessionUser();
  if (!user) redirect('/login');
  // getSessionUser() already reflects a fresh DB read (see auth.ts's session
  // callback) — no need for a second prisma.user.findUnique just for this check.
  if (!canViewScheduling(user)) redirect('/');
  const { post, row } = await searchParams;

  return (
    <div className="eve-wide-page">
      <header className="eve-wide-page__header">
        <Link href="/" className="eve-btn eve-btn--icon" title={strings.profile.back}>
          <EveArch size={18} />
        </Link>
        <h1 className="eve-profile__title">{post ? 'Editar post' : 'Agendar Post'}</h1>
      </header>

      <div className="eve-wide-page__body">
        <PostComposer key={post ?? row ?? 'new'} postId={post} rowId={row} />
      </div>
    </div>
  );
}
