'use client';

import { useMemo, useState, type FormEvent, type JSX } from 'react';
import { ImageDropZone } from './ImageDropZone';
import { PostPreview } from './PostPreview';
import type { ClientOption, MetaAccount, ScheduledPostRow } from './scheduling-types';
import { useEscapeToClose } from './useEscapeToClose';

export interface PostEditorProps {
  clients: ClientOption[];
  accounts: MetaAccount[];
  /** null/undefined = creating a new post; a row = editing it. */
  initial?: ScheduledPostRow | null;
  defaultDate?: Date;
  onClose: () => void;
  onSaved: () => void;
}

function toLocalInputValue(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function PostEditor({ clients, accounts, initial, defaultDate, onClose, onSaved }: PostEditorProps): JSX.Element {
  useEscapeToClose(onClose);
  const isEditing = Boolean(initial);

  const [clientId, setClientId] = useState(initial?.clientId ?? clients[0]?.id ?? '');
  const [platform, setPlatform] = useState<ScheduledPostRow['platform']>(initial?.platform ?? 'instagram');
  const [postType, setPostType] = useState<ScheduledPostRow['postType']>(initial?.postType ?? 'feed');
  const [connectorInstanceId, setConnectorInstanceId] = useState(initial?.connectorInstanceId ?? (accounts[0]?.id ?? ''));
  const [caption, setCaption] = useState(initial?.caption ?? '');
  const [mediaUrl, setMediaUrl] = useState(initial?.mediaUrl ?? '');
  const [scheduledFor, setScheduledFor] = useState(() =>
    toLocalInputValue(initial ? new Date(initial.scheduledFor) : (defaultDate ?? new Date(Date.now() + 30 * 60 * 1000))),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const eligibleAccounts = platform === 'instagram' ? accounts.filter((account) => account.hasInstagram) : accounts;
  const accountLabel = useMemo(
    () => accounts.find((account) => account.id === connectorInstanceId)?.label ?? '',
    [accounts, connectorInstanceId],
  );

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setError(null);

    const client = clients.find((option) => option.id === clientId);
    if (!client) {
      setError('Selecione um cliente.');
      setBusy(false);
      return;
    }
    if (!mediaUrl) {
      setError('Escolha uma imagem.');
      setBusy(false);
      return;
    }

    try {
      const response = isEditing
        ? await fetch(`/api/scheduling/posts/${initial!.id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              caption,
              mediaUrl,
              scheduledFor: new Date(scheduledFor).toISOString(),
              client: { id: client.id, label: client.label },
            }),
          })
        : await fetch('/api/scheduling/posts', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              connectorInstanceId,
              client: { id: client.id, label: client.label },
              platform,
              postType,
              caption,
              mediaUrl,
              scheduledFor: new Date(scheduledFor).toISOString(),
            }),
          });

      const body = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) {
        setError(body.error ?? `HTTP ${response.status}`);
        return;
      }

      onSaved();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!initial) return;
    setBusy(true);
    try {
      const response = await fetch(`/api/scheduling/posts/${initial.id}`, { method: 'DELETE' });
      if (response.ok) onSaved();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="eve-modal-backdrop" onClick={onClose}>
      <form
        className="eve-modal eve-modal--wide eve-post-editor"
        onClick={(event) => event.stopPropagation()}
        onSubmit={(event) => void submit(event)}
      >
        <div className="eve-post-editor__fields">
          <h2 className="eve-card__title">{isEditing ? 'Editar post' : 'Novo post'}</h2>

          {error && <p className="eve-alert eve-alert--error">{error}</p>}

          {!isEditing && (
            <div className="eve-post-editor__type-row">
              <div className="eve-segmented">
                <button
                  type="button"
                  className={platform === 'instagram' ? 'eve-segmented__btn is-active' : 'eve-segmented__btn'}
                  onClick={() => setPlatform('instagram')}
                >
                  Instagram
                </button>
                <button
                  type="button"
                  className={platform === 'facebook' ? 'eve-segmented__btn is-active' : 'eve-segmented__btn'}
                  onClick={() => setPlatform('facebook')}
                >
                  Facebook
                </button>
              </div>
              <div className="eve-segmented">
                <button
                  type="button"
                  className={postType === 'feed' ? 'eve-segmented__btn is-active' : 'eve-segmented__btn'}
                  onClick={() => setPostType('feed')}
                >
                  Feed
                </button>
                <button
                  type="button"
                  className={postType === 'story' ? 'eve-segmented__btn is-active' : 'eve-segmented__btn'}
                  onClick={() => setPostType('story')}
                >
                  Story
                </button>
              </div>
            </div>
          )}

          <label className="eve-field">
            <span className="eve-field__label">Cliente</span>
            <select className="eve-input" value={clientId} onChange={(event) => setClientId(event.target.value)} required>
              {clients.length === 0 && <option value="">Nenhum cliente cadastrado</option>}
              {clients.map((client) => (
                <option key={client.id} value={client.id}>
                  {client.label}
                </option>
              ))}
            </select>
          </label>

          {!isEditing && (
            <label className="eve-field">
              <span className="eve-field__label">Conta</span>
              <select
                className="eve-input"
                value={connectorInstanceId}
                onChange={(event) => setConnectorInstanceId(event.target.value)}
                required
              >
                {eligibleAccounts.length === 0 && <option value="">Nenhuma conta conectada</option>}
                {eligibleAccounts.map((account) => (
                  <option key={account.id} value={account.id}>
                    {account.label}
                  </option>
                ))}
              </select>
            </label>
          )}

          {postType === 'feed' && (
            <label className="eve-field">
              <span className="eve-field__label">Legenda</span>
              <textarea
                className="eve-input eve-notes__textarea"
                value={caption}
                onChange={(event) => setCaption(event.target.value)}
                maxLength={2200}
                required
              />
            </label>
          )}

          <label className="eve-field">
            <span className="eve-field__label">Imagem</span>
            <ImageDropZone
              value={mediaUrl || null}
              onChange={(url) => setMediaUrl(url ?? '')}
              endpoint="/api/uploads/post-media"
              dropHint="Arraste uma imagem aqui ou clique para escolher"
              uploadingHint="Enviando..."
              removeLabel="Remover imagem"
            />
          </label>

          <label className="eve-field">
            <span className="eve-field__label">Quando publicar</span>
            <input
              className="eve-input"
              type="datetime-local"
              value={scheduledFor}
              onChange={(event) => setScheduledFor(event.target.value)}
              required
            />
          </label>

          <div className="eve-profile__actions">
            <button type="submit" className="eve-btn eve-btn--primary" disabled={busy}>
              {isEditing ? 'Salvar' : 'Agendar'}
            </button>
            {isEditing && (
              <button type="button" className="eve-btn eve-btn--danger" disabled={busy} onClick={() => void remove()}>
                Cancelar post
              </button>
            )}
            <button type="button" className="eve-btn" onClick={onClose} disabled={busy}>
              Fechar
            </button>
          </div>
        </div>

        <div className="eve-post-editor__preview">
          <span className="eve-dim eve-post-editor__preview-label">Pré-visualização</span>
          <PostPreview
            platform={platform}
            postType={postType}
            accountLabel={accountLabel}
            caption={caption}
            mediaUrl={mediaUrl || null}
          />
        </div>
      </form>
    </div>
  );
}
