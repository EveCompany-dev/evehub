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
import { X } from '@eve/ui';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState, type FormEvent, type JSX } from 'react';
import { CarouselDropZone, uploadMedia } from './CarouselDropZone';
import { MediaThumb } from './MediaThumb';
import { PlatformIcon } from './PlatformIcon';
import { PostPreview } from './PostPreview';
import { POST_TYPE_LABEL, type ClientOption, type MetaAccount, type ScheduledPostRow } from './scheduling-types';
import { useEscapeToClose } from './useEscapeToClose';

const UPLOAD_ENDPOINT = '/api/uploads/post-media';
const IMAGE_ACCEPT = 'image/png,image/jpeg,image/webp,image/gif';
const MEDIA_ACCEPT = `${IMAGE_ACCEPT},video/mp4,video/quicktime,video/webm`;

/** One post being written. A batch is several of these, each shown as its own sub-page. */
interface PostDraft {
  key: string;
  clientId: string;
  connectorInstanceId: string;
  /** Target keys, "instagram:feed". */
  targets: string[];
  caption: string;
  mediaUrl: string;
  carouselMode: boolean;
  carouselUrls: string[];
  /** datetime-local value. */
  scheduledFor: string;
  error: string | null;
}

function targetKey(target: PostTarget): string {
  return `${target.platform}:${target.postType}`;
}

const INSTAGRAM_FEED = targetKey({ platform: 'instagram', postType: 'feed' });
const INSTAGRAM_REEL = targetKey({ platform: 'instagram', postType: 'reel' });

/** Stories are the one target Meta gives no caption field. */
function acceptsCaption(target: PostTarget): boolean {
  return target.postType !== 'story';
}

function toLocalInputValue(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function inHalfAnHour(): string {
  return toLocalInputValue(new Date(Date.now() + 30 * 60 * 1000));
}

// A counter, not crypto.randomUUID(): the app is also opened over plain http
// on the LAN (phones), where randomUUID doesn't exist.
let draftCounter = 0;
function newKey(): string {
  draftCounter += 1;
  return `draft-${draftCounter}`;
}

function emptyDraft(): PostDraft {
  return {
    key: newKey(),
    clientId: '',
    connectorInstanceId: '',
    targets: [INSTAGRAM_FEED],
    caption: '',
    mediaUrl: '',
    carouselMode: false,
    carouselUrls: [],
    scheduledFor: inHalfAnHour(),
    error: null,
  };
}

function draftFromPost(post: ScheduledPostRow): PostDraft {
  return {
    key: newKey(),
    clientId: post.clientId ?? '',
    connectorInstanceId: post.connectorInstanceId,
    targets: [targetKey(post)],
    caption: post.caption,
    mediaUrl: post.mediaUrl,
    carouselMode: Boolean(post.mediaUrls && post.mediaUrls.length >= MIN_CAROUSEL_ITEMS),
    carouselUrls: post.mediaUrls ?? [],
    scheduledFor: toLocalInputValue(new Date(post.scheduledFor)),
    error: null,
  };
}

/** The targets this media can go to; if none of the chosen ones can, the obvious one for its kind. */
function fitTargets(targets: string[], url: string): string[] {
  const kind = mediaKindFromUrl(url);
  const fitting = ALL_TARGETS.filter((target) => targets.includes(targetKey(target)) && targetAcceptsMedia(target, kind)).map(targetKey);
  return fitting.length > 0 ? fitting : [kind === 'video' ? INSTAGRAM_REEL : INSTAGRAM_FEED];
}

/** Everything the form and the submit need to know about a draft, from what is loaded right now. */
function inspect(draft: PostDraft, clients: ClientOption[], accounts: MetaAccount[], isEditing: boolean) {
  const targets = ALL_TARGETS.filter((target) => draft.targets.includes(targetKey(target)));
  // Carousels only exist on the Instagram feed, and editing never turns a post into one.
  const instagramFeedOnly = !isEditing && targets.length === 1 && targets[0]!.platform === 'instagram' && targets[0]!.postType === 'feed';
  const carousel = instagramFeedOnly && draft.carouselMode;
  const mediaKind = draft.mediaUrl ? mediaKindFromUrl(draft.mediaUrl) : null;
  const incompatible = mediaKind ? targets.filter((target) => !targetAcceptsMedia(target, mediaKind)) : [];
  const eligibleAccounts = targets.some((target) => target.platform === 'instagram') ? accounts.filter((account) => account.hasInstagram) : accounts;
  // Lists load after the first render, so a stored id may not match anything
  // (yet): fall back to the first option, which is what the <select> shows.
  const accountId = isEditing
    ? draft.connectorInstanceId
    : eligibleAccounts.some((account) => account.id === draft.connectorInstanceId)
      ? draft.connectorInstanceId
      : (eligibleAccounts[0]?.id ?? '');
  const client = clients.find((option) => option.id === draft.clientId) ?? clients[0] ?? null;
  return { targets, instagramFeedOnly, carousel, mediaKind, incompatible, eligibleAccounts, accountId, client };
}

function problemWith(draft: PostDraft, info: ReturnType<typeof inspect>, isEditing: boolean, now: boolean): string | null {
  if (!info.client) return 'Selecione um cliente.';
  if (info.carousel) {
    if (draft.carouselUrls.length < MIN_CAROUSEL_ITEMS) return `Escolha pelo menos ${MIN_CAROUSEL_ITEMS} fotos para o carrossel.`;
  } else if (!draft.mediaUrl) {
    return 'Escolha uma imagem ou vídeo.';
  }
  if (!isEditing && info.targets.length === 0) return 'Escolha ao menos um destino.';
  if (!isEditing && !info.accountId) return 'Nenhuma conta do Meta conectada para esse destino.';
  if (info.incompatible.length > 0) {
    return `${info.incompatible.map(targetLabel).join(', ')}: ${info.mediaKind === 'video' ? 'não aceita vídeo' : 'precisa de um vídeo'}.`;
  }
  if (info.targets.some(acceptsCaption) && !draft.caption.trim()) return 'Escreva a legenda.';
  if (!now && Number.isNaN(new Date(draft.scheduledFor).getTime())) return 'Escolha quando publicar.';
  return null;
}

export interface PostComposerProps {
  /** Edit this post (from the Agenda do Time) instead of writing new ones. */
  postId?: string;
}

/**
 * Agendar Post: the post editor as a page of its own, away from any
 * calendar (posts show up on the Agenda do Time once scheduled). Several
 * files dropped at once ask whether they are one carousel or separate posts;
 * separate posts become sub-pages — one post each, each with its own date,
 * caption and destinations — scheduled together with one click.
 */
export function PostComposer({ postId }: PostComposerProps): JSX.Element {
  const router = useRouter();
  const [clients, setClients] = useState<ClientOption[]>([]);
  const [accounts, setAccounts] = useState<MetaAccount[]>([]);
  const [accountsLoaded, setAccountsLoaded] = useState(false);
  const [failed, setFailed] = useState<ScheduledPostRow[]>([]);
  const [editing, setEditing] = useState<ScheduledPostRow | null>(null);
  /** "Agendar de novo" turned the post opened by `postId` into a new one: stop waiting for it. */
  const [reused, setReused] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [drafts, setDrafts] = useState<PostDraft[]>(() => [emptyDraft()]);
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [previewKey, setPreviewKey] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [pendingFiles, setPendingFiles] = useState<File[] | null>(null);
  const [uploadProgress, setUploadProgress] = useState<string | null>(null);

  const isEditing = editing !== null;
  const active = drafts.find((draft) => draft.key === activeKey) ?? drafts[0]!;
  const activeIndex = drafts.indexOf(active);
  const info = inspect(active, clients, accounts, isEditing);
  // Published/failed rows can't be edited any more (the API says the same).
  const locked = editing !== null && editing.status !== 'draft' && editing.status !== 'scheduled';

  const loadFailed = useCallback(async () => {
    try {
      const response = await fetch('/api/scheduling/posts?status=failed', { cache: 'no-store' });
      if (response.ok) setFailed(((await response.json()) as { posts: ScheduledPostRow[] }).posts);
    } catch {
      // The list is a courtesy; the Agenda do Time marks failed posts too.
    }
  }, []);

  useEffect(() => {
    // Mount fetch — every setState happens after an await (same case as useWidgetData.ts).
    void (async () => {
      try {
        const [clientsResponse, accountsResponse] = await Promise.all([
          fetch('/api/scheduling/clients', { cache: 'no-store' }),
          fetch('/api/scheduling/meta-accounts', { cache: 'no-store' }),
        ]);
        if (clientsResponse.ok) setClients(((await clientsResponse.json()) as { clients: ClientOption[] }).clients);
        if (accountsResponse.ok) setAccounts(((await accountsResponse.json()) as { accounts: MetaAccount[] }).accounts);
      } catch (cause) {
        setLoadError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        setAccountsLoaded(true);
      }
    })();
  }, []);

  useEffect(() => {
    if (postId) {
      void (async () => {
        try {
          const response = await fetch(`/api/scheduling/posts/${encodeURIComponent(postId)}`, { cache: 'no-store' });
          const body = (await response.json().catch(() => ({}))) as { post?: ScheduledPostRow; error?: string };
          if (!response.ok || !body.post) {
            setLoadError(body.error ?? `HTTP ${response.status}`);
            return;
          }
          setEditing(body.post);
          setDrafts([draftFromPost(body.post)]);
          setActiveKey(null);
        } catch (cause) {
          setLoadError(cause instanceof Error ? cause.message : String(cause));
        }
      })();
    } else {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      void loadFailed();
    }
  }, [postId, loadFailed]);

  const patchDraft = (key: string, patch: Partial<PostDraft>) => {
    // "3 posts agendados" is about the last batch, not the one being written now.
    setNotice(null);
    setDrafts((current) => current.map((draft) => (draft.key === key ? { ...draft, error: null, ...patch } : draft)));
  };

  const toggleTarget = (target: PostTarget) => {
    const key = targetKey(target);
    patchDraft(active.key, { targets: active.targets.includes(key) ? active.targets.filter((item) => item !== key) : [...active.targets, key] });
  };

  const removeDraft = (key: string) => {
    const at = drafts.findIndex((draft) => draft.key === key);
    const rest = drafts.filter((draft) => draft.key !== key);
    setDrafts(rest);
    if (key === active.key) setActiveKey(rest[Math.min(at, rest.length - 1)]?.key ?? null);
  };

  /** The answer to "carrossel ou posts separados?": upload, then shape the drafts accordingly. */
  const applyManyFiles = async (files: File[], as: 'carousel' | 'separate') => {
    setPendingFiles(null);
    setNotice(null);
    const base = active;
    const list = as === 'carousel' ? files.slice(0, MAX_CAROUSEL_ITEMS) : files;
    const urls: string[] = [];
    const errors: string[] = [];
    for (const [index, file] of list.entries()) {
      setUploadProgress(`Enviando ${index + 1} de ${list.length}…`);
      try {
        urls.push(await uploadMedia(UPLOAD_ENDPOINT, file));
      } catch (cause) {
        errors.push(`${file.name}: ${cause instanceof Error ? cause.message : String(cause)}`);
      }
    }
    setUploadProgress(null);
    const error = errors.length > 0 ? errors.join(' ') : null;

    if (urls.length === 0) {
      patchDraft(base.key, { error });
      return;
    }
    if (as === 'carousel') {
      patchDraft(base.key, { targets: [INSTAGRAM_FEED], carouselMode: true, carouselUrls: urls, mediaUrl: urls[0]!, error });
      return;
    }
    // Every sub-page starts as a copy of the post being written, each with one of the files as its media.
    const split = urls.map((url, index) => ({
      ...base,
      key: index === 0 ? base.key : newKey(),
      mediaUrl: url,
      carouselMode: false,
      carouselUrls: [],
      targets: fitTargets(base.targets, url),
      error: index === 0 ? error : null,
    }));
    setDrafts((current) => current.flatMap((draft) => (draft.key === base.key ? split : [draft])));
    setActiveKey(base.key);
  };

  const send = async (draft: PostDraft, scheduledFor: string): Promise<{ error: string | null; targets?: string[] }> => {
    const details = inspect(draft, clients, accounts, isEditing);
    const client = { id: details.client!.id, label: details.client!.label };
    const response = editing
      ? await fetch(`/api/scheduling/posts/${editing.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ caption: draft.caption, mediaUrl: draft.mediaUrl, scheduledFor, client }),
        })
      : await fetch('/api/scheduling/posts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            connectorInstanceId: details.accountId,
            client,
            targets: details.targets,
            caption: draft.caption,
            mediaUrl: draft.mediaUrl,
            ...(details.carousel ? { mediaUrls: draft.carouselUrls } : {}),
            scheduledFor,
          }),
        });
    const body = (await response.json().catch(() => ({}))) as { error?: string; errors?: string[]; posts?: ScheduledPostRow[] };
    if (!response.ok) return { error: body.error ?? `HTTP ${response.status}` };
    // Partial success: the rows that worked exist now and must not be created
    // twice, so only the targets that failed stay on the draft for a retry.
    if (body.errors && body.errors.length > 0) {
      const created = (body.posts ?? []).map(targetKey);
      return { error: body.errors.join(' '), targets: draft.targets.filter((key) => !created.includes(key)) };
    }
    return { error: null };
  };

  /**
   * "Agendar" and "Postar agora" for one post or the whole batch. Everything
   * is checked first, so a batch never goes out half-way because one sub-page
   * lacks a caption. "Postar agora" is a `scheduled` row due immediately,
   * picked up by the worker's next tick like anything else due — including
   * its per-account throttling (apps/worker SAME_ACCOUNT_GAP_MS), which keeps
   * a burst of posts from reading as automation abuse to Meta.
   */
  const run = async (now: boolean) => {
    setNotice(null);
    const problems = drafts.map((draft) => problemWith(draft, inspect(draft, clients, accounts, isEditing), isEditing, now));
    if (problems.some(Boolean)) {
      setDrafts((current) => current.map((draft, index) => ({ ...draft, error: problems[index] ?? null })));
      setActiveKey(drafts[problems.findIndex(Boolean)]!.key);
      return;
    }

    setBusy(true);
    const left: PostDraft[] = [];
    let sent = 0;
    for (const draft of drafts) {
      try {
        const result = await send(draft, (now ? new Date() : new Date(draft.scheduledFor)).toISOString());
        if (result.error === null) sent += 1;
        else left.push({ ...draft, error: result.error, targets: result.targets ?? draft.targets });
      } catch (cause) {
        left.push({ ...draft, error: cause instanceof Error ? cause.message : String(cause) });
      }
    }
    setBusy(false);

    if (left.length === 0) {
      if (editing) {
        router.push('/agenda');
        return;
      }
      setDrafts([emptyDraft()]);
      setActiveKey(null);
      setNotice(now ? (sent === 1 ? 'Post enviado para publicação.' : `${sent} posts enviados para publicação.`) : sent === 1 ? 'Post agendado.' : `${sent} posts agendados.`);
    } else {
      setDrafts(left);
      setActiveKey(left[0]!.key);
      if (sent > 0) setNotice(`${sent} de ${drafts.length} foram. Os que faltam continuam abertos, com o motivo.`);
    }
    void loadFailed();
  };

  const remove = async () => {
    if (!editing) return;
    setBusy(true);
    try {
      const response = await fetch(`/api/scheduling/posts/${editing.id}`, { method: 'DELETE' });
      if (response.ok) router.push('/agenda');
      else patchDraft(active.key, { error: ((await response.json().catch(() => ({}))) as { error?: string }).error ?? `HTTP ${response.status}` });
    } finally {
      setBusy(false);
    }
  };

  /** A post that failed or already went out can't be edited; this starts a new one with the same content. */
  const reuseAsNew = () => {
    setEditing(null);
    setReused(true);
    setDrafts([{ ...active, key: newKey(), scheduledFor: inHalfAnHour(), error: null }]);
    setActiveKey(null);
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void run(false);
  };

  if (postId && !editing && !reused) {
    return loadError ? (
      <p className="eve-alert eve-alert--error">
        {loadError} <Link href="/agenda">Voltar para a Agenda do Time</Link>
      </p>
    ) : (
      <p className="eve-dim">carregando...</p>
    );
  }

  const accountLabel = accounts.find((account) => account.id === info.accountId)?.label ?? '';
  const previewTarget = info.targets.find((target) => targetKey(target) === previewKey) ?? info.targets[0] ?? null;
  const batch = drafts.length > 1;

  return (
    <div className="eve-composer">
      {loadError && <p className="eve-alert eve-alert--error">{loadError}</p>}

      {!isEditing && accountsLoaded && accounts.length === 0 && (
        <div className="eve-alert eve-scheduling__setup-hint">
          <span>Nenhuma conta do Meta conectada ainda — conecte uma Página do Facebook para agendar posts.</span>
          <Link href="/connectors" className="eve-btn eve-btn--primary">
            Conectar no Conectores
          </Link>
        </div>
      )}

      {!isEditing && failed.length > 0 && (
        <section className="eve-card eve-scheduling__panel eve-scheduling__panel--alert">
          <h4 className="eve-card__title">Não publicados ({failed.length})</h4>
          <div className="eve-post-list">
            {failed.map((post) => (
              <Link key={post.id} href={`/scheduling?post=${post.id}`} className="eve-post-row is-failed">
                <MediaThumb url={post.mediaUrl} className="eve-post-row__thumb" />
                <span className="eve-post-row__body">
                  <span className="eve-post-row__top">
                    <PlatformIcon platform={post.platform} size={16} />
                    <strong>{post.clientLabel}</strong>
                    <span className="eve-dim">· {POST_TYPE_LABEL[post.postType]}</span>
                  </span>
                  {post.statusMessage && (
                    <span className="eve-post-row__error" title={post.statusMessage}>
                      {post.statusMessage}
                    </span>
                  )}
                </span>
              </Link>
            ))}
          </div>
        </section>
      )}

      {notice && (
        <p className="eve-alert">
          {notice} <Link href="/agenda">Ver na Agenda do Time</Link>
        </p>
      )}

      {batch && (
        <div className="eve-subposts" role="tablist" aria-label="Posts deste lote">
          {drafts.map((draft, index) => {
            const className = ['eve-subpost', draft.key === active.key ? 'is-active' : '', draft.error ? 'is-error' : ''].filter(Boolean).join(' ');
            return (
              <span key={draft.key} className={className}>
                <button type="button" role="tab" aria-selected={draft.key === active.key} className="eve-subpost__open" onClick={() => setActiveKey(draft.key)}>
                  {draft.mediaUrl ? <MediaThumb url={draft.mediaUrl} className="eve-subpost__thumb" /> : <span className="eve-subpost__thumb" aria-hidden="true" />}
                  Post {index + 1}
                </button>
                <button type="button" className="eve-subpost__x" aria-label={`Tirar o post ${index + 1} do lote`} title="Tirar do lote" onClick={() => removeDraft(draft.key)}>
                  <X size={12} aria-hidden="true" />
                </button>
              </span>
            );
          })}
        </div>
      )}

      <form key={active.key} className="eve-card eve-post-editor" onSubmit={submit}>
        <div className="eve-post-editor__fields">
          {batch && (
            <h2 className="eve-card__title">
              Post {activeIndex + 1} de {drafts.length}
            </h2>
          )}

          {active.error && <p className="eve-alert eve-alert--error">{active.error}</p>}
          {editing?.status === 'failed' && editing.statusMessage && (
            <p className="eve-alert eve-alert--error">Não publicou: {editing.statusMessage}</p>
          )}
          {locked && editing?.status !== 'failed' && <p className="eve-alert">Este post já foi publicado.</p>}

          <label className="eve-field">
            <span className="eve-field__label">Cliente</span>
            <select className="eve-input" value={info.client?.id ?? ''} disabled={locked} onChange={(event) => patchDraft(active.key, { clientId: event.target.value })}>
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
              <select className="eve-input" value={info.accountId} onChange={(event) => patchDraft(active.key, { connectorInstanceId: event.target.value })}>
                {info.eligibleAccounts.length === 0 && <option value="">Nenhuma conta conectada</option>}
                {info.eligibleAccounts.map((account) => (
                  <option key={account.id} value={account.id}>
                    {account.label}
                  </option>
                ))}
              </select>
            </label>
          )}

          {info.instagramFeedOnly && (
            <label className="eve-check">
              <input type="checkbox" checked={active.carouselMode} onChange={(event) => patchDraft(active.key, { carouselMode: event.target.checked })} />
              <span>Carrossel</span>
            </label>
          )}

          <div className="eve-field">
            <span className="eve-field__label">Mídia</span>
            {locked ? (
              <MediaThumb url={active.mediaUrl} className="eve-composer__locked-media" />
            ) : (
              <CarouselDropZone
                value={info.carousel ? active.carouselUrls : active.mediaUrl ? [active.mediaUrl] : []}
                onChange={(urls) =>
                  patchDraft(active.key, info.carousel ? { carouselUrls: urls, mediaUrl: urls[0] ?? '' } : { mediaUrl: urls[0] ?? '' })
                }
                endpoint={UPLOAD_ENDPOINT}
                accept={info.carousel ? IMAGE_ACCEPT : MEDIA_ACCEPT}
                max={info.carousel ? MAX_CAROUSEL_ITEMS : 1}
                dropHint={
                  info.carousel
                    ? 'Arraste fotos aqui ou clique para escolher'
                    : isEditing
                      ? 'Arraste uma imagem ou vídeo aqui ou clique para escolher'
                      : 'Arraste uma ou várias imagens/vídeos aqui ou clique para escolher'
                }
                uploadingHint="Enviando..."
                busyHint={uploadProgress}
                limitHint={(max) => (info.carousel ? `Só cabem ${max} fotos por carrossel — o restante foi ignorado.` : 'Escolha um arquivo por vez.')}
                onManyFiles={isEditing ? undefined : setPendingFiles}
              />
            )}
          </div>

          {info.targets.some(acceptsCaption) && (
            <label className="eve-field">
              <span className="eve-field__label">Legenda</span>
              <textarea
                className="eve-input eve-notes__textarea"
                value={active.caption}
                disabled={locked}
                onChange={(event) => patchDraft(active.key, { caption: event.target.value })}
                maxLength={2200}
              />
              {info.targets.some((target) => !acceptsCaption(target)) && (
                <span className="eve-setup__hint">Stories saem sem legenda — o Meta não aceita uma.</span>
              )}
            </label>
          )}

          <label className="eve-field">
            <span className="eve-field__label">Quando publicar</span>
            <input
              className="eve-input"
              type="datetime-local"
              value={active.scheduledFor}
              disabled={locked}
              onChange={(event) => patchDraft(active.key, { scheduledFor: event.target.value })}
            />
          </label>

          <div className="eve-profile__actions">
            {locked ? (
              <>
                <button type="button" className="eve-btn eve-btn--primary" onClick={reuseAsNew}>
                  Agendar de novo
                </button>
                <button type="button" className="eve-btn eve-btn--danger" disabled={busy} onClick={() => void remove()}>
                  Excluir post
                </button>
              </>
            ) : (
              <>
                <button type="submit" className="eve-btn eve-btn--primary" disabled={busy || uploadProgress !== null}>
                  {isEditing ? 'Salvar' : batch ? `Agendar todos (${drafts.length})` : `Agendar${info.targets.length > 1 ? ` (${info.targets.length})` : ''}`}
                </button>
                <button
                  type="button"
                  className="eve-btn"
                  disabled={busy || uploadProgress !== null}
                  onClick={() => void run(true)}
                  title="Publica assim que o worker rodar, sem esperar o horário escolhido"
                >
                  {batch ? 'Publicar todos agora' : 'Postar agora'}
                </button>
                {isEditing && (
                  <button type="button" className="eve-btn eve-btn--danger" disabled={busy} onClick={() => void remove()}>
                    Cancelar post
                  </button>
                )}
              </>
            )}
            {isEditing && (
              <Link href="/agenda" className="eve-btn">
                Voltar
              </Link>
            )}
          </div>
        </div>

        <div className="eve-post-editor__preview">
          <span className="eve-dim eve-post-editor__preview-label">Pré-visualização</span>

          {info.targets.length > 1 && (
            <div className="eve-preview-tabs">
              {info.targets.map((target) => {
                const key = targetKey(target);
                return (
                  <button
                    key={key}
                    type="button"
                    className={previewTarget !== null && targetKey(previewTarget) === key ? 'eve-preview-tab is-active' : 'eve-preview-tab'}
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
                caption={active.caption}
                mediaUrl={active.mediaUrl || null}
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
                  const on = active.targets.includes(key);
                  const blocked = on && info.incompatible.includes(target);
                  // An incompatible target can't be ticked in the first place; one
                  // that became incompatible after the media changed must stay untickable-off.
                  const disabled = !on && info.mediaKind !== null && !targetAcceptsMedia(target, info.mediaKind);
                  return (
                    <button
                      key={key}
                      type="button"
                      className={`eve-target${on ? ' is-active' : ''}${blocked ? ' is-blocked' : ''}`}
                      onClick={() => toggleTarget(target)}
                      aria-pressed={on}
                      disabled={disabled}
                      title={
                        blocked || disabled
                          ? `${targetLabel(target)} ${info.mediaKind === 'video' ? 'não aceita vídeo' : 'precisa de um vídeo'}`
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

      {pendingFiles && (
        <ManyFilesDialog
          files={pendingFiles}
          onCancel={() => setPendingFiles(null)}
          onChoose={(as) => void applyManyFiles(pendingFiles, as)}
        />
      )}
    </div>
  );
}

interface ManyFilesDialogProps {
  files: File[];
  onCancel: () => void;
  onChoose: (as: 'carousel' | 'separate') => void;
}

/** "Você escolheu 5 arquivos": one carousel, or five posts to schedule together. */
function ManyFilesDialog({ files, onCancel, onChoose }: ManyFilesDialogProps): JSX.Element {
  useEscapeToClose(onCancel);
  const hasVideo = files.some((file) => file.type.startsWith('video/'));
  const slides = Math.min(files.length, MAX_CAROUSEL_ITEMS);

  return (
    <div className="eve-modal-backdrop" onClick={onCancel}>
      <div className="eve-modal eve-manyfiles" role="dialog" aria-modal="true" aria-labelledby="eve-manyfiles-title" onClick={(event) => event.stopPropagation()}>
        <h2 id="eve-manyfiles-title" className="eve-card__title">
          {files.length} arquivos
        </h2>
        <p className="eve-dim">Como você quer publicar?</p>

        <div className="eve-manyfiles__options">
          <button type="button" className="eve-manyfiles__option" disabled={hasVideo} onClick={() => onChoose('carousel')}>
            <strong>Um carrossel</strong>
            <span className="eve-dim">
              {hasVideo
                ? 'Carrossel aceita só fotos — tem vídeo na seleção.'
                : `Um post no Instagram Feed com ${slides} fotos${files.length > MAX_CAROUSEL_ITEMS ? ` (só as ${MAX_CAROUSEL_ITEMS} primeiras)` : ''}.`}
            </span>
          </button>
          <button type="button" className="eve-manyfiles__option" onClick={() => onChoose('separate')}>
            <strong>{files.length} posts separados</strong>
            <span className="eve-dim">Um post por arquivo, cada um com data, legenda e destinos próprios. Agende todos de uma vez.</span>
          </button>
        </div>

        <div className="eve-profile__actions">
          <button type="button" className="eve-btn" onClick={onCancel}>
            Cancelar
          </button>
        </div>
      </div>
    </div>
  );
}
