import { strings } from '@eve/ui';
import Link from 'next/link';
import type { JSX } from 'react';
import { findUsableReset, RESET_LINK_INVALID } from '../../lib/password-reset';
import { ResetPasswordForm } from './ResetPasswordForm';

export const dynamic = 'force-dynamic';

/**
 * Onde o link gerado por um admin leva. Sem sessao: o token e a prova. A
 * pagina so confere se o link ainda vale (para dizer "expirou" antes de a
 * pessoa digitar duas senhas a toa); quem consome o token e a API.
 */
export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<JSX.Element> {
  const params = await searchParams;
  const token = typeof params.token === 'string' ? params.token : '';
  const reset = token ? await findUsableReset(token) : null;

  return (
    <div className="eve-login">
      <div className="eve-login__card">
        <h1 className="eve-login__title">{strings.auth.resetTitle}</h1>

        {reset ? (
          <>
            <p className="eve-login__subtitle">
              {reset.user.name?.trim() || reset.user.email} · {reset.user.email}
            </p>
            <ResetPasswordForm token={token} />
          </>
        ) : (
          <>
            <p className="eve-login__error">{RESET_LINK_INVALID}</p>
            <Link href="/login" className="eve-btn eve-btn--block">
              {strings.auth.backToSignIn}
            </Link>
          </>
        )}
      </div>
    </div>
  );
}
