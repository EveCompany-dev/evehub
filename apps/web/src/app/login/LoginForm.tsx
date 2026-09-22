'use client';

import { strings } from '@eve/ui';
import { useRouter } from 'next/navigation';
import { signIn } from 'next-auth/react';
import { useState, type FormEvent, type JSX } from 'react';

function messageForError(error: string | null, code: string | null): string | null {
  if (!error) return null;
  if (code === 'rate_limited') return strings.auth.tooManyAttempts;
  if (code === 'server_error') return strings.auth.serviceUnavailable;
  if (error === 'NotRegistered') return strings.auth.notRegistered;
  if (error === 'AccessDenied') return strings.auth.domainNotAllowed;
  if (error === 'CredentialsSignin') return strings.auth.invalidCredentials;
  return strings.auth.genericError;
}

/**
 * "Esqueci minha senha": nao manda e-mail, avisa os admins. A resposta e a
 * mesma exista a conta ou nao (ver /api/password-reset/request).
 */
function ForgotPasswordForm({ initialEmail, onBack }: { initialEmail: string; onBack: () => void }): JSX.Element {
  const [email, setEmail] = useState(initialEmail);
  const [pending, setPending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      const response = await fetch('/api/password-reset/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      const body = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) {
        setError(body.error ?? strings.auth.genericError);
        return;
      }
      setSent(true);
    } catch {
      setError(strings.auth.genericError);
    } finally {
      setPending(false);
    }
  };

  return (
    <>
      <p className="eve-login__notice">
        <strong>{strings.auth.forgotTitle}.</strong> {sent ? strings.auth.forgotSent : strings.auth.forgotHint}
      </p>
      {error && <p className="eve-login__error">{error}</p>}

      {!sent && (
        <form onSubmit={(event) => void onSubmit(event)}>
          <label className="eve-field">
            <span className="eve-field__label">{strings.auth.email}</span>
            <input
              className="eve-input"
              type="email"
              name="email"
              autoComplete="username"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              inputMode="email"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value.trim())}
            />
          </label>
          <button type="submit" className="eve-btn eve-btn--primary eve-btn--block" disabled={pending}>
            {pending ? strings.auth.forgotSending : strings.auth.forgotSubmit}
          </button>
        </form>
      )}

      <button type="button" className="eve-login__link" onClick={onBack}>
        {strings.auth.backToSignIn}
      </button>
    </>
  );
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
  const [forgot, setForgot] = useState(false);
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

  if (forgot) {
    return (
      <ForgotPasswordForm
        initialEmail={email}
        onBack={() => {
          setForgot(false);
          setError(null);
        }}
      />
    );
  }

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

      <button type="button" className="eve-login__link" onClick={() => setForgot(true)}>
        {strings.auth.forgotPassword}
      </button>

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
