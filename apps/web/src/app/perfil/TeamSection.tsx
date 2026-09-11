'use client';

import { strings } from '@eve/ui';
import { useCallback, useEffect, useState, type FormEvent, type JSX } from 'react';
import { Avatar } from './ProfileForm';

export interface TeamMember {
  id: string;
  name: string | null;
  email: string;
  image: string | null;
  isOwner: boolean;
  disabled: boolean;
  hasPassword: boolean;
  lastSeenAt: string | null;
}

/**
 * Gestao de equipe, visivel so para owners.
 *
 * O componente nao decide nada sozinho: cada acao passa pela API, que reavalia
 * a permissao e as travas (ultimo owner, autodesativacao). Esconder o botao e
 * cortesia com o usuario, nao controle de acesso.
 */
export function TeamSection({ currentUserId }: { currentUserId: string }): JSX.Element {
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState({ name: '', email: '', password: '', isOwner: false });

  const load = useCallback(async () => {
    try {
      const response = await fetch('/api/users', { cache: 'no-store' });
      const body = (await response.json().catch(() => ({}))) as { users?: TeamMember[]; error?: string };
      if (!response.ok || !body.users) {
        setError(body.error ?? `HTTP ${response.status}`);
        return;
      }
      setMembers(body.users);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const addMember = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);

    try {
      const response = await fetch('/api/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: draft.name,
          email: draft.email,
          password: draft.password || undefined,
          isOwner: draft.isOwner,
        }),
      });

      const body = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) {
        setError(body.error ?? `HTTP ${response.status}`);
        return;
      }

      setDraft({ name: '', email: '', password: '', isOwner: false });
      setAdding(false);
      setNotice(strings.team.added);
      await load();
    } finally {
      setBusy(false);
    }
  };

  const patch = async (id: string, changes: { isOwner?: boolean; disabled?: boolean }) => {
    setError(null);
    setNotice(null);

    const response = await fetch(`/api/users/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(changes),
    });

    const body = (await response.json().catch(() => ({}))) as { error?: string };
    if (!response.ok) {
      // 409 aqui e uma trava proposital (ultimo owner), nao uma falha.
      setError(body.error ?? `HTTP ${response.status}`);
      return;
    }
    await load();
  };

  return (
    <section className="eve-card">
      <div className="eve-team__head">
        <h2 className="eve-card__title">{strings.team.title}</h2>
        <button type="button" className="eve-btn" onClick={() => setAdding((value) => !value)}>
          {adding ? strings.team.cancel : strings.team.add}
        </button>
      </div>

      <p className="eve-dim eve-profile__hint">{strings.team.hint}</p>

      {error && <p className="eve-alert eve-alert--error">{error}</p>}
      {notice && <p className="eve-alert">{notice}</p>}

      {adding && (
        <form className="eve-team__form" onSubmit={(event) => void addMember(event)}>
          <label className="eve-field">
            <span className="eve-field__label">{strings.team.name}</span>
            <input
              className="eve-input"
              required
              value={draft.name}
              onChange={(event) => setDraft({ ...draft, name: event.target.value })}
            />
          </label>

          <label className="eve-field">
            <span className="eve-field__label">{strings.team.email}</span>
            <input
              className="eve-input"
              type="email"
              required
              value={draft.email}
              onChange={(event) => setDraft({ ...draft, email: event.target.value })}
            />
          </label>

          <label className="eve-field">
            <span className="eve-field__label">{strings.team.password}</span>
            <input
              className="eve-input"
              type="password"
              autoComplete="new-password"
              minLength={8}
              value={draft.password}
              onChange={(event) => setDraft({ ...draft, password: event.target.value })}
            />
            <span className="eve-setup__hint">{strings.team.passwordHint}</span>
          </label>

          <label className="eve-check">
            <input
              type="checkbox"
              checked={draft.isOwner}
              onChange={(event) => setDraft({ ...draft, isOwner: event.target.checked })}
            />
            <span>{strings.team.makeOwner}</span>
          </label>

          <button type="submit" className="eve-btn eve-btn--primary" disabled={busy}>
            {busy ? strings.team.adding : strings.team.confirmAdd}
          </button>
        </form>
      )}

      {loading ? (
        <p className="eve-dim">carregando...</p>
      ) : (
        <ul className="eve-team__list">
          {members.map((member) => (
            <li key={member.id} className={member.disabled ? 'eve-team__row is-disabled' : 'eve-team__row'}>
              <Avatar name={member.name} email={member.email} image={member.image} size={36} />

              <span className="eve-team__who">
                <span className="eve-team__name">
                  {member.name ?? member.email}
                  {member.id === currentUserId && <span className="eve-dim"> · {strings.team.you}</span>}
                </span>
                <span className="eve-dim">{member.email}</span>
                <span className="eve-dim eve-team__meta">
                  {member.isOwner ? strings.team.owner : strings.team.member}
                  {' · '}
                  {member.hasPassword ? strings.team.hasPassword : strings.team.googleOnly}
                  {member.disabled ? ` · ${strings.team.disabled}` : ''}
                </span>
              </span>

              <span className="eve-team__actions">
                <button
                  type="button"
                  className="eve-btn"
                  onClick={() => void patch(member.id, { isOwner: !member.isOwner })}
                >
                  {member.isOwner ? strings.team.demote : strings.team.promote}
                </button>
                <button
                  type="button"
                  className="eve-btn"
                  onClick={() => void patch(member.id, { disabled: !member.disabled })}
                >
                  {member.disabled ? strings.team.enable : strings.team.disable}
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
