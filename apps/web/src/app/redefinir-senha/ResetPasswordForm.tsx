'use client';

import { strings } from '@eve/ui';
import Link from 'next/link';
import { useState, type FormEvent, type JSX } from 'react';

export function ResetPasswordForm({ token }: { token: string }): JSX.Element {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (password !== confirm) {
      setError(strings.auth.resetMismatch);
      return;
    }
    setPending(true);
    setError(null);
    try {
      const response = await fetch('/api/password-reset/complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, password }),
      });
      const body = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) {
        setError(body.error ?? strings.auth.genericError);
        return;
      }
      setDone(true);
    } catch {
      setError(strings.auth.genericError);
    } finally {
      setPending(false);
    }
  };

  if (done) {
    return (
      <>
        <p className="eve-login__notice">{strings.auth.resetDone}</p>
        <Link href="/login" className="eve-btn eve-btn--primary eve-btn--block">
          {strings.auth.signIn}
        </Link>
      </>
    );
  }

  return (
    <>
      {error && <p className="eve-login__error">{error}</p>}
      <form onSubmit={(event) => void onSubmit(event)}>
        <label className="eve-field">
          <span className="eve-field__label">{strings.auth.resetNewPassword}</span>
          <input
            className="eve-input"
            type="password"
            autoComplete="new-password"
            minLength={8}
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
          <span className="eve-setup__hint">Pelo menos 8 caracteres.</span>
        </label>
        <label className="eve-field">
          <span className="eve-field__label">{strings.auth.resetConfirm}</span>
          <input
            className="eve-input"
            type="password"
            autoComplete="new-password"
            minLength={8}
            required
            value={confirm}
            onChange={(event) => setConfirm(event.target.value)}
          />
        </label>
        <button type="submit" className="eve-btn eve-btn--primary eve-btn--block" disabled={pending}>
          {pending ? strings.auth.resetSaving : strings.auth.resetSubmit}
        </button>
      </form>
    </>
  );
}
