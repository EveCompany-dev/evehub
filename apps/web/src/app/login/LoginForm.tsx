'use client';

import { strings } from '@eve/ui';
import { useRouter } from 'next/navigation';
import { signIn } from 'next-auth/react';
import { useState, type FormEvent, type JSX } from 'react';

function messageForError(error: string | null, code: string | null): string | null {
  if (!error) return null;
  if (code === 'rate_limited') return strings.auth.tooManyAttempts;
  if (code === 'server_error') return strings.auth.serviceUnavailable;
  if (error === 'AccessDenied') return strings.auth.domainNotAllowed;
  if (error === 'CredentialsSignin') return strings.auth.invalidCredentials;
  return strings.auth.genericError;
}

export function LoginForm({
  hasGoogle,
  initialError,
  initialCode,
}: {
  hasGoogle: boolean;
  initialError: string | null;
  initialCode: string | null;
}): JSX.Element {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(messageForError(initialError, initialCode));

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setPending(true);
    setError(null);

    try {
      // redirect:false so an invalid login re-renders in place instead of
      // bouncing through an error URL.
      const result = await signIn('credentials', { email, password, redirect: false });

      if (result?.error) {
        setError(messageForError(result.error, result.code ?? null));
        return;
      }

      // refresh() re-runs the server component so it picks up the new session.
      router.replace('/');
      router.refresh();
    } catch (cause) {
      // Without this the button would sit on "Entrando..." forever whenever
      // signIn rejects — a server hiccup, a non-JSON response, a dropped
      // connection. Always surface something the user can act on.
      console.error('[login] signIn falhou:', cause);
      setError(strings.auth.genericError);
    } finally {
      setPending(false);
    }
  };

  return (
    <>
      {error && <p className="eve-login__error">{error}</p>}

      <form onSubmit={(event) => void onSubmit(event)}>
        <label className="eve-field">
          <span className="eve-field__label">{strings.auth.email}</span>
          <input
            className="eve-input"
            type="email"
            name="email"
            autoComplete="username"
            // Teclado de celular: sem isto ele capitaliza a primeira letra e
            // oferece correcao automatica no meio de um e-mail.
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            inputMode="email"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value.trim())}
          />
        </label>

        <label className="eve-field">
          <span className="eve-field__label">{strings.auth.password}</span>
          <input
            className="eve-input"
            type="password"
            name="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </label>

        <button type="submit" className="eve-btn eve-btn--primary eve-btn--block" disabled={pending}>
          {pending ? strings.auth.signingIn : strings.auth.signIn}
        </button>
      </form>

      {hasGoogle && (
        <>
          <div className="eve-login__divider">{strings.auth.or}</div>
          <button
            type="button"
            className="eve-btn eve-btn--block"
            onClick={() => void signIn('google', { callbackUrl: '/' })}
          >
            {strings.auth.signInWithGoogle}
          </button>
        </>
      )}
    </>
  );
}
