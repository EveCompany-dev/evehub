import { strings } from '@eve/ui';
import { redirect } from 'next/navigation';
import type { JSX } from 'react';
import { getSessionUser } from '../../lib/session';
import { LoginForm } from './LoginForm';

export const dynamic = 'force-dynamic';

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<JSX.Element> {
  if (await getSessionUser()) redirect('/');

  const params = await searchParams;
  const first = (value: string | string[] | undefined) => (Array.isArray(value) ? (value[0] ?? null) : (value ?? null));

  // Google is only offered when it is actually configured, so a fresh clone
  // without OAuth credentials does not show a button that cannot work.
  const hasGoogle = Boolean(process.env.AUTH_GOOGLE_ID && process.env.AUTH_GOOGLE_SECRET);

  return (
    <div className="eve-login">
      <div className="eve-login__card">
        <h1 className="eve-login__title">{strings.auth.signInTitle}</h1>
        <p className="eve-login__subtitle">{strings.auth.signInSubtitle}</p>

        <LoginForm hasGoogle={hasGoogle} initialError={first(params.error)} initialCode={first(params.code)} />
      </div>
    </div>
  );
}
