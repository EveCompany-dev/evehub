'use client';

import { EveArch, strings } from '@eve/ui';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent, type JSX } from 'react';
import { ImageDropZone } from '../../components/ImageDropZone';

export interface ProfileData {
  id: string;
  name: string | null;
  email: string;
  image: string | null;
  isOwner: boolean;
  hasPassword: boolean;
}

function initials(name: string | null, email: string): string {
  const source = name?.trim() || email;
  const parts = source.split(/[\s@._-]+/).filter(Boolean);
  return parts
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
}

/** Avatar com fallback: foto se houver, senao as iniciais sobre o laranja da marca. */
export function Avatar({
  name,
  email,
  image,
  size = 40,
}: {
  name: string | null;
  email: string;
  image: string | null;
  size?: number;
}): JSX.Element {
  if (image) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img className="eve-avatar" src={image} alt="" width={size} height={size} style={{ width: size, height: size }} />;
  }

  return (
    <span className="eve-avatar eve-avatar--fallback" style={{ width: size, height: size, fontSize: size * 0.38 }}>
      {initials(name, email)}
    </span>
  );
}

export function ProfileForm({ initial }: { initial: ProfileData }): JSX.Element {
  const router = useRouter();

  const [profile, setProfile] = useState(initial);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({
    name: initial.name ?? '',
    email: initial.email,
    image: initial.image ?? '',
  });
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [reveal, setReveal] = useState(false);
  const [passwordBusy, setPasswordBusy] = useState(false);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [passwordNotice, setPasswordNotice] = useState<string | null>(null);

  const saveProfile = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaving(true);
    setError(null);
    setNotice(null);

    try {
      const response = await fetch('/api/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: draft.name, email: draft.email, image: draft.image || null }),
      });

      const body = (await response.json().catch(() => ({}))) as { error?: string; profile?: ProfileData };

      if (!response.ok || !body.profile) {
        setError(body.error ?? `HTTP ${response.status}`);
        return;
      }

      setProfile({ ...profile, ...body.profile });
      setEditing(false);
      setNotice(strings.profile.saved);
      // O cabecalho mostra nome e avatar, entao precisa re-renderizar.
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSaving(false);
    }
  };

  const savePassword = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setPasswordBusy(true);
    setPasswordError(null);
    setPasswordNotice(null);

    try {
      const response = await fetch('/api/profile/password', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          currentPassword: profile.hasPassword ? currentPassword : undefined,
          newPassword,
        }),
      });

      const body = (await response.json().catch(() => ({}))) as { error?: string };

      if (!response.ok) {
        setPasswordError(body.error ?? `HTTP ${response.status}`);
        return;
      }

      setProfile({ ...profile, hasPassword: true });
      setCurrentPassword('');
      setNewPassword('');
      setPasswordNotice(strings.profile.passwordChanged);
    } catch (cause) {
      setPasswordError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setPasswordBusy(false);
    }
  };

  return (
    <div className="eve-profile">
      <header className="eve-profile__header">
        <button type="button" className="eve-btn eve-btn--icon" onClick={() => router.push('/')} title={strings.profile.back}>
          <EveArch size={18} />
        </button>
        <h1 className="eve-profile__title">{strings.profile.title}</h1>
      </header>

      <section className="eve-card">
        <div className="eve-profile__identity">
          <Avatar name={profile.name} email={profile.email} image={profile.image} size={72} />
          <div>
            <p className="eve-profile__name">{profile.name ?? profile.email}</p>
            <p className="eve-dim">{profile.email}</p>
            <span className="eve-tag">{profile.isOwner ? strings.profile.owner : strings.profile.member}</span>
          </div>
        </div>

        {notice && <p className="eve-alert">{notice}</p>}
        {error && <p className="eve-alert eve-alert--error">{error}</p>}

        {editing ? (
          <form onSubmit={(event) => void saveProfile(event)}>
            <label className="eve-field">
              <span className="eve-field__label">{strings.profile.name}</span>
              <input
                className="eve-input"
                value={draft.name}
                required
                onChange={(event) => setDraft({ ...draft, name: event.target.value })}
              />
            </label>

            <label className="eve-field">
              <span className="eve-field__label">{strings.profile.email}</span>
              {/* O e-mail e o login: so um admin troca, pela tela de Equipe (ver validateEmailChange). */}
              <input className="eve-input" type="email" value={draft.email} readOnly disabled />
              <span className="eve-setup__hint">Para trocar o e-mail da conta, peça a um administrador.</span>
            </label>

            <label className="eve-field">
              <span className="eve-field__label">{strings.profile.picture}</span>
              <ImageDropZone
                value={draft.image || null}
                onChange={(url) => setDraft({ ...draft, image: url ?? '' })}
                endpoint="/api/uploads/avatar"
                dropHint={strings.profile.pictureDropZone}
                uploadingHint={strings.profile.pictureUploading}
                removeLabel={strings.profile.pictureRemove}
                shape="round"
              />
            </label>

            <div className="eve-profile__actions">
              <button type="submit" className="eve-btn eve-btn--primary" disabled={saving}>
                {strings.profile.save}
              </button>
              <button
                type="button"
                className="eve-btn"
                onClick={() => {
                  setEditing(false);
                  setDraft({ name: profile.name ?? '', email: profile.email, image: profile.image ?? '' });
                }}
              >
                {strings.profile.cancel}
              </button>
            </div>
          </form>
        ) : (
          <button type="button" className="eve-btn" onClick={() => setEditing(true)}>
            {strings.profile.edit}
          </button>
        )}
      </section>

      <section className="eve-card">
        <h2 className="eve-card__title">{strings.profile.passwordTitle}</h2>
        <p className="eve-dim eve-profile__hint">{strings.profile.passwordHint}</p>

        {!profile.hasPassword && <p className="eve-alert">{strings.profile.noPasswordYet}</p>}
        {passwordNotice && <p className="eve-alert">{passwordNotice}</p>}
        {passwordError && <p className="eve-alert eve-alert--error">{passwordError}</p>}

        <form onSubmit={(event) => void savePassword(event)}>
          {profile.hasPassword && (
            <label className="eve-field">
              <span className="eve-field__label">{strings.profile.currentPassword}</span>
              <input
                className="eve-input"
                type={reveal ? 'text' : 'password'}
                autoComplete="current-password"
                value={currentPassword}
                required
                onChange={(event) => setCurrentPassword(event.target.value)}
              />
            </label>
          )}

          <label className="eve-field">
            <span className="eve-field__label">{strings.profile.newPassword}</span>
            <input
              className="eve-input"
              type={reveal ? 'text' : 'password'}
              autoComplete="new-password"
              minLength={8}
              value={newPassword}
              required
              onChange={(event) => setNewPassword(event.target.value)}
            />
          </label>

          <div className="eve-profile__actions">
            <button type="submit" className="eve-btn eve-btn--primary" disabled={passwordBusy}>
              {profile.hasPassword ? strings.profile.changePassword : strings.profile.setPassword}
            </button>
            <button type="button" className="eve-btn" onClick={() => setReveal((value) => !value)}>
              {reveal ? strings.profile.hidePassword : strings.profile.showPassword}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
