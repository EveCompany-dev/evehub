'use client';

import {
  ALL_TARGETS,
  MAX_CAROUSEL_ITEMS,
  MIN_CAROUSEL_ITEMS,
  mediaKindFromUrl,
  targetAcceptsMedia,
  targetLabel,
  type PostTarget,
} from '@eve/connector-meta/shared';
import { useMemo, useState, type FormEvent, type JSX } from 'react';
import { CarouselDropZone } from './CarouselDropZone';
import { PlatformIcon } from './PlatformIcon';
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

/** Stories are the one target Meta gives no caption field. */
function acceptsCaption(target: PostTarget): boolean {
  return target.postType !== 'story';
}

function targetKey(target: PostTarget): string {
  return `${target.platform}:${target.postType}`;
}

function toLocalInputValue(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function PostEditor({ clients, accounts, initial, defaultDate, onClose, onSaved }: PostEditorProps): JSX.Element {
  useEscapeToClose(onClose);
  const isEditing = Boolean(initial);

  const [clientId, setClientId] = useState(initial?.clientId ?? clients[0]?.id ?? '');

  // Creating fans out to any number of targets; editing stays pinned to the
  // one row being edited, since each row is published independently and
  // retargeting an already-submitted post is not a thing Meta supports.
  const [selected, setSelected] = useState<string[]>(() =>
    initial ? [targetKey({ platform: initial.platform, postType: initial.postType })] : [targetKey(ALL_TARGETS[0]!)],
  );

  const [connectorInstanceId, setConnectorInstanceId] = useState(initial?.connectorInstanceId ?? (accounts[0]?.id ?? ''));
  const [caption, setCaption] = useState(initial?.caption ?? '');
  const [mediaUrl, setMediaUrl] = useState(initial?.mediaUrl ?? '');
  const [carouselMode, setCarouselMode] = useState(Boolean(initial?.mediaUrls && initial.mediaUrls.length >= MIN_CAROUSEL_ITEMS));
  const [carouselUrls, setCarouselUrls] = useState<string[]>(initial?.mediaUrls ?? []);
  const [scheduledFor, setScheduledFor] = useState(() =>
    toLocalInputValue(initial ? new Date(initial.scheduledFor) : (defaultDate ?? new Date(Date.now() + 30 * 60 * 1000))),
  );
  const [previewKey, setPreviewKey] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedTargets = useMemo(
    () => ALL_TARGETS.filter((target) => selected.includes(targetKey(target))),
    [selected],
  );

  const mediaKind = mediaUrl ? mediaKindFromUrl(mediaUrl) : null;

  // Which selected targets the chosen media cannot go to — shown inline on
  // the picker rather than only on submit, so the conflict is visible while
  // the choice is being made.
  const incompatible = useMemo(
    () => (mediaKind ? selectedTargets.filter((target) => !targetAcceptsMedia(target, mediaKind)) : []),
    [selectedTargets, mediaKind],
  );

  // Carousels only exist on the Instagram feed (see the API route's same
  // check) — as soon as the selection stops being exactly that one target,
  // drop out of carousel mode instead of leaving a stale, now-unsendable
  // combination sitting in the form.
  const isInstagramFeedOnly =
    !isEditing &&
    selectedTargets.length === 1 &&
    selectedTargets[0]!.platform === 'instagram' &&
    selectedTargets[0]!.postType === 'feed';
  if (carouselMode && !isInstagramFeedOnly) setCarouselMode(false);

  const needsInstagram = selectedTargets.some((target) => target.platform === 'instagram');
  const eligibleAccounts = needsInstagram ? accounts.filter((account) => account.hasInstagram) : accounts;
  const accountLabel = useMemo(
    () => accounts.find((account) => account.id === connectorInstanceId)?.label ?? '',
    [accounts, connectorInstanceId],
  );

  const showCaption = selectedTargets.some(acceptsCaption);

  // The preview shows one target at a time; default to the first selected one
  // so it always shows something relevant even as the selection changes.
  const previewTarget = selectedTargets.find((target) => targetKey(target) === previewKey) ?? selectedTargets[0] ?? null;

  const toggleTarget = (target: PostTarget) => {
    const key = targetKey(target);
    setSelected((current) => (current.includes(key) ? current.filter((item) => item !== key) : [...current, key]));
  };

  /**
   * Shared by the normal submit (picked date) and "Postar agora" (now) — the
   * only difference between them is which ISO string goes in `scheduledFor`.
   * "Postar agora" still lands as a `scheduled` row due immediately, picked
   * up by the worker's next tick exactly like anything else that's due — see
   * postNowRef's comment above for why that matters.
   */
  const run = async (scheduledForIso: string) => {
    setBusy(true);
    setError(null);

    const client = clients.find((option) => option.id === clientId);
    if (!client) {
      setError('Selecione um cliente.');
      setBusy(false);
      return;
    }
    if (carouselMode) {
      if (carouselUrls.length < MIN_CAROUSEL_ITEMS) {
        setError(`Escolha pelo menos ${MIN_CAROUSEL_ITEMS} fotos para o carrossel.`);
        setBusy(false);
        return;
      }
    } else if (!mediaUrl) {
      setError('Escolha uma imagem ou vídeo.');
      setBusy(false);
      return;
    }
    if (!isEditing && selectedTargets.length === 0) {
      setError('Escolha ao menos um destino.');
      setBusy(false);
      return;
    }
    if (incompatible.length > 0) {
      setError(
        `${incompatible.map(targetLabel).join(', ')}: ${mediaKind === 'video' ? 'não aceita vídeo' : 'precisa de um vídeo'}.`,
      );
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
              scheduledFor: scheduledForIso,
              client: { id: client.id, label: client.label },
            }),
          })
        : await fetch('/api/scheduling/posts', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              connectorInstanceId,
              client: { id: client.id, label: client.label },
              targets: selectedTargets,
              caption,
              mediaUrl,
              ...(carouselMode ? { mediaUrls: carouselUrls } : {}),
              scheduledFor: scheduledForIso,
            }),
          });

      const body = (await response.json().catch(() => ({}))) as {
        error?: string;
        errors?: string[];
        posts?: ScheduledPostRow[];
      };
      if (!response.ok) {
        setError(body.error ?? `HTTP ${response.status}`);
        return;
      }

      // Partial success: some rows exist now and must not be created twice,
      // so the ones that worked are dropped from the selection and the editor
      // stays open showing what didn't — resubmitting retries only those.
      if (body.errors && body.errors.length > 0) {
        const createdKeys = (body.posts ?? []).map((post) =>
          targetKey({ platform: post.platform, postType: post.postType }),
        );
        setSelected((current) => current.filter((key) => !createdKeys.includes(key)));
        setError(body.errors.join(' '));
        return;
      }

      onSaved();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void run(new Date(scheduledFor).toISOString());
  };

  // Reuses the exact same submit path with scheduledFor forced to now,
  // rather than a separate immediate-publish call straight to Meta — it
  // lands as a `scheduled` row due immediately, picked up by the worker's
  // next tick exactly like anything else that's due, including the same
  // per-account throttling (see apps/worker's SAME_ACCOUNT_GAP_MS) that
  // keeps a burst of "post now" clicks across many client accounts from
  // reading as automation abuse to Meta.
  const postNow = () => void run(new Date().toISOString());

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

          {isInstagramFeedOnly && (
            <label className="eve-check">
              <input type="checkbox" checked={carouselMode} onChange={(event) => setCarouselMode(event.target.checked)} />
              <span>Carrossel</span>
            </label>
          )}

          <label className="eve-field">
            <span className="eve-field__label">Mídia</span>
            <CarouselDropZone
              value={carouselMode ? carouselUrls : mediaUrl ? [mediaUrl] : []}
              onChange={(urls) => {
                if (carouselMode) {
                  setCarouselUrls(urls);
                  setMediaUrl(urls[0] ?? '');
                } else {
                  setMediaUrl(urls[0] ?? '');
                }
              }}
              endpoint="/api/uploads/post-media"
              accept={carouselMode ? 'image/png,image/jpeg,image/webp,image/gif' : 'image/png,image/jpeg,image/webp,image/gif,video/mp4,video/quicktime,video/webm'}
              max={carouselMode ? MAX_CAROUSEL_ITEMS : 1}
              dropHint={carouselMode ? 'Arraste fotos aqui ou clique para escolher' : 'Arraste uma imagem ou vídeo aqui ou clique para escolher'}
              uploadingHint="Enviando..."
              limitHint={(max) =>
                carouselMode ? `Só cabem ${max} fotos por carrossel — o restante foi ignorado.` : 'Escolha um arquivo por vez.'
              }
            />
          </label>

          {showCaption && (
            <label className="eve-field">
              <span className="eve-field__label">Legenda</span>
              <textarea
                className="eve-input eve-notes__textarea"
                value={caption}
                onChange={(event) => setCaption(event.target.value)}
                maxLength={2200}
                required
              />
              {selectedTargets.some((target) => !acceptsCaption(target)) && (
                <span className="eve-setup__hint">Stories saem sem legenda — o Meta não aceita uma.</span>
              )}
            </label>
          )}

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
              {isEditing ? 'Salvar' : `Agendar${selectedTargets.length > 1 ? ` (${selectedTargets.length})` : ''}`}
            </button>
            <button type="button" className="eve-btn" disabled={busy} onClick={postNow} title="Publica assim que o worker rodar, sem esperar o horário escolhido">
              Postar agora
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

          {selectedTargets.length > 1 && (
            <div className="eve-preview-tabs">
              {selectedTargets.map((target) => {
                const key = targetKey(target);
                const active = previewTarget !== null && targetKey(previewTarget) === key;
                return (
                  <button
                    key={key}
                    type="button"
                    className={active ? 'eve-preview-tab is-active' : 'eve-preview-tab'}
                    onClick={() => setPreviewKey(key)}
                  >
                    <PlatformIcon platform={target.platform} size={14} />
                    {targetLabel(target).replace(/^(Instagram|Facebook) /, '')}
                  </button>
                );
              })}
            </div>
          )}

          <div className="eve-post-editor__preview-frame">
            {previewTarget ? (
              <PostPreview
                platform={previewTarget.platform}
                postType={previewTarget.postType}
                accountLabel={accountLabel}
                caption={caption}
                mediaUrl={mediaUrl || null}
              />
            ) : (
              <p className="eve-dim">Escolha um destino para ver a prévia.</p>
            )}
          </div>

          {!isEditing && (
            <div className="eve-field">
              <span className="eve-field__label">Onde publicar</span>
              <div className="eve-targets">
                {ALL_TARGETS.map((target) => {
                  const key = targetKey(target);
                  const active = selected.includes(key);
                  const blocked = active && incompatible.includes(target);
                  // Can't check an incompatible target in the first place (a video
                  // attached, say, disables Instagram Feed outright) — the only way
                  // to hit `blocked` below is a target that WAS compatible when
                  // selected and stopped being so after the media changed, and
                  // unchecking it has to stay possible.
                  const disabled = !active && mediaKind !== null && !targetAcceptsMedia(target, mediaKind);
                  return (
                    <button
                      key={key}
                      type="button"
                      className={`eve-target${active ? ' is-active' : ''}${blocked ? ' is-blocked' : ''}`}
                      onClick={() => toggleTarget(target)}
                      aria-pressed={active}
                      disabled={disabled}
                      title={
                        blocked || disabled
                          ? `${targetLabel(target)} ${mediaKind === 'video' ? 'não aceita vídeo' : 'precisa de um vídeo'}`
                          : targetLabel(target)
                      }
                    >
                      <PlatformIcon platform={target.platform} size={18} />
                      <span>{targetLabel(target).replace(/^(Instagram|Facebook) /, '')}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </form>
    </div>
  );
}
