'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState, type JSX } from 'react';
import { MonthGrid } from './MonthGrid';
import { PlatformIcon } from './PlatformIcon';
import { PostEditor } from './PostEditor';
import type { ClientOption, MetaAccount, ScheduledPostRow } from './scheduling-types';

type EditorState = { mode: 'new'; date?: Date } | { mode: 'edit'; post: ScheduledPostRow } | null;
type StatusFilter = 'all' | ScheduledPostRow['status'];

const TYPE_LABEL: Record<ScheduledPostRow['postType'], string> = {
  feed: 'post',
  story: 'story',
};

const STATUS_LABEL: Record<ScheduledPostRow['status'], string> = {
  draft: 'rascunho',
  scheduled: 'agendado',
  publishing: 'publicando',
  published: 'publicado',
  failed: 'falhou',
};

/** How many upcoming posts the side list shows before it stops being a summary. */
const UPCOMING_LIMIT = 12;

function isoDateOnly(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function timeOnly(iso: string): string {
  return new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

function dayAndTime(iso: string): string {
  return new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}

export interface SchedulingCalendarProps {
  /** Lets the parent refresh things derived from posts, e.g. the failed-post "!" badge. */
  onPostsChanged?: () => void;
}

export function SchedulingCalendar({ onPostsChanged }: SchedulingCalendarProps): JSX.Element {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth());

  const [clients, setClients] = useState<ClientOption[]>([]);
  const [accounts, setAccounts] = useState<MetaAccount[]>([]);
  const [posts, setPosts] = useState<ScheduledPostRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingPosts, setLoadingPosts] = useState(true);

  const [filterClient, setFilterClient] = useState('');
  const [filterPlatforms, setFilterPlatforms] = useState<Set<ScheduledPostRow['platform']>>(
    new Set(['instagram', 'facebook']),
  );
  const [filterStatus, setFilterStatus] = useState<StatusFilter>('all');
  const [editor, setEditor] = useState<EditorState>(null);
  const [error, setError] = useState<string | null>(null);

  // Each loader fails independently into the same error banner — a hiccup
  // fetching, say, Meta accounts must not stop clients/posts from loading.
  const loadClients = useCallback(async () => {
    try {
      const response = await fetch('/api/scheduling/clients', { cache: 'no-store' });
      if (response.ok) setClients(((await response.json()) as { clients: ClientOption[] }).clients);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, []);

  const loadAccounts = useCallback(async () => {
    try {
      const response = await fetch('/api/scheduling/meta-accounts', { cache: 'no-store' });
      if (response.ok) setAccounts(((await response.json()) as { accounts: MetaAccount[] }).accounts);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  }, []);

  const loadPosts = useCallback(async () => {
    setLoadingPosts(true);
    try {
      const from = new Date(year, month, 1);
      const to = new Date(year, month + 1, 0, 23, 59, 59);
      const params = new URLSearchParams({ from: from.toISOString(), to: to.toISOString() });
      if (filterClient) params.set('client', filterClient);
      if (filterStatus !== 'all') params.set('status', filterStatus);

      const response = await fetch(`/api/scheduling/posts?${params.toString()}`, { cache: 'no-store' });
      if (!response.ok) {
        setError(`HTTP ${response.status}`);
        return;
      }
      const body = (await response.json()) as { posts: ScheduledPostRow[] };
      setPosts(body.posts.filter((post) => filterPlatforms.has(post.platform)));
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoadingPosts(false);
    }
  }, [year, month, filterClient, filterPlatforms, filterStatus]);

  useEffect(() => {
    // Mount fetch — same legitimate case as useWidgetData.ts's initial fetch.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadClients();
    void loadAccounts();
  }, [loadClients, loadAccounts]);

  useEffect(() => {
    // Mount/filter-change fetch — every setState inside loadPosts() happens
    // after an await, never synchronously during the effect (same legitimate
    // case documented in useWidgetData.ts's initial fetch).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadPosts();
  }, [loadPosts]);

  const postsByDay = useMemo(() => {
    const map = new Map<string, ScheduledPostRow[]>();
    for (const post of posts) {
      const key = isoDateOnly(new Date(post.scheduledFor));
      map.set(key, [...(map.get(key) ?? []), post]);
    }
    return map;
  }, [posts]);

  // Anything that still needs attention, soonest first: what failed (the
  // publish window is gone and someone has to act) ahead of what is merely
  // coming up.
  const failed = useMemo(() => posts.filter((post) => post.status === 'failed'), [posts]);

  const upcoming = useMemo(
    () =>
      posts
        .filter((post) => post.status !== 'failed' && new Date(post.scheduledFor).getTime() >= Date.now())
        .slice(0, UPCOMING_LIMIT),
    [posts],
  );

  const togglePlatform = (platform: ScheduledPostRow['platform']) => {
    setFilterPlatforms((current) => {
      const next = new Set(current);
      if (next.has(platform)) next.delete(platform);
      else next.add(platform);
      return next;
    });
  };

  const refresh = () => {
    void loadPosts();
    onPostsChanged?.();
  };

  const hasAccount = accounts.length > 0;

  const renderPostRow = (post: ScheduledPostRow) => (
    <button
      key={post.id}
      type="button"
      className={`eve-post-row is-${post.status}`}
      onClick={() => setEditor({ mode: 'edit', post })}
    >
      {post.mediaUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- uploaded URL, not a static asset.
        <img className="eve-post-row__thumb" src={post.mediaUrl} alt="" />
      ) : (
        <span className="eve-post-row__thumb eve-post-row__thumb--empty" aria-hidden="true" />
      )}

      <span className="eve-post-row__body">
        <span className="eve-post-row__top">
          <PlatformIcon platform={post.platform} size={16} />
          <strong>{post.clientLabel}</strong>
          <span className="eve-dim">· {TYPE_LABEL[post.postType]}</span>
        </span>
        <span className="eve-dim eve-post-row__when">{dayAndTime(post.scheduledFor)}</span>
        {post.status === 'failed' && post.statusMessage && (
          <span className="eve-post-row__error" title={post.statusMessage}>
            {post.statusMessage}
          </span>
        )}
      </span>

      <span className={`eve-status-dot is-${post.status}`} title={STATUS_LABEL[post.status]} />
    </button>
  );

  return (
    <div className="eve-scheduling">
      {!loading && !hasAccount && (
        <div className="eve-alert eve-scheduling__setup-hint">
          <span>Nenhuma conta do Meta conectada ainda — conecte uma Página do Facebook para agendar posts.</span>
          <Link href="/connectors" className="eve-btn eve-btn--primary">
            Conectar no Conectores
          </Link>
        </div>
      )}

      <div className="eve-scheduling__filters eve-card">
        <label className="eve-field eve-scheduling__filter">
          <span className="eve-field__label">Cliente</span>
          <select className="eve-input" value={filterClient} onChange={(event) => setFilterClient(event.target.value)}>
            <option value="">Todos</option>
            {clients.map((client) => (
              <option key={client.id} value={client.id}>
                {client.label}
              </option>
            ))}
          </select>
        </label>

        <div className="eve-scheduling__filter">
          <span className="eve-field__label">Plataforma</span>
          <div className="eve-platform-toggles">
            {(['instagram', 'facebook'] as const).map((platform) => {
              const active = filterPlatforms.has(platform);
              const label = platform === 'instagram' ? 'Instagram' : 'Facebook';
              return (
                <button
                  key={platform}
                  type="button"
                  className={active ? 'eve-platform-toggle is-active' : 'eve-platform-toggle'}
                  onClick={() => togglePlatform(platform)}
                  aria-pressed={active}
                  title={label}
                >
                  <PlatformIcon platform={platform} size={22} />
                  <span className="eve-sr-only">{label}</span>
                </button>
              );
            })}
          </div>
        </div>

        <label className="eve-field eve-scheduling__filter">
          <span className="eve-field__label">Status</span>
          <select
            className="eve-input"
            value={filterStatus}
            onChange={(event) => setFilterStatus(event.target.value as StatusFilter)}
          >
            <option value="all">Todos</option>
            <option value="scheduled">Agendados</option>
            <option value="published">Publicados</option>
            <option value="failed">Falharam</option>
            <option value="draft">Rascunhos</option>
          </select>
        </label>

        <button
          type="button"
          className="eve-btn eve-btn--primary eve-scheduling__new-btn"
          disabled={!hasAccount}
          onClick={() => setEditor({ mode: 'new' })}
        >
          + Novo post
        </button>
      </div>

      {error && <p className="eve-alert eve-alert--error">{error}</p>}

      <div className="eve-scheduling__body">
        <div className="eve-scheduling__calendar">
          <MonthGrid
            year={year}
            month={month}
            onMonthChange={(nextYear, nextMonth) => {
              setYear(nextYear);
              setMonth(nextMonth);
            }}
            onDayClick={(date) => hasAccount && setEditor({ mode: 'new', date })}
            renderDay={(date) => (
              <div className="eve-month__chips">
                {(postsByDay.get(isoDateOnly(date)) ?? []).map((post) => (
                  <button
                    key={post.id}
                    type="button"
                    className={`eve-month__chip is-${post.status}`}
                    onClick={(event) => {
                      event.stopPropagation();
                      setEditor({ mode: 'edit', post });
                    }}
                    title={
                      post.status === 'failed' && post.statusMessage
                        ? `${STATUS_LABEL[post.status]}: ${post.statusMessage}`
                        : `${timeOnly(post.scheduledFor)} · ${STATUS_LABEL[post.status]} — ${post.caption}`
                    }
                  >
                    {post.mediaUrl && (
                      // eslint-disable-next-line @next/next/no-img-element -- uploaded URL, not a static asset.
                      <img className="eve-month__chip-thumb" src={post.mediaUrl} alt="" />
                    )}
                    <PlatformIcon platform={post.platform} size={13} />
                    <span className="eve-month__chip-time">{timeOnly(post.scheduledFor)}</span>
                    <span className="eve-month__chip-label">
                      {post.clientLabel}
                      {post.postType === 'feed' ? '' : ` · ${TYPE_LABEL[post.postType]}`}
                    </span>
                    {post.status === 'failed' && <span className="eve-month__chip-bang">!</span>}
                  </button>
                ))}
              </div>
            )}
          />
        </div>

        <aside className="eve-scheduling__side">
          {failed.length > 0 && (
            <section className="eve-card eve-scheduling__panel eve-scheduling__panel--alert">
              <h4 className="eve-card__title">Não publicados ({failed.length})</h4>
              <div className="eve-post-list">{failed.map(renderPostRow)}</div>
            </section>
          )}

          <section className="eve-card eve-scheduling__panel">
            <h4 className="eve-card__title">Próximos posts</h4>
            {loadingPosts ? (
              <div className="eve-post-list" aria-hidden="true">
                {[0, 1, 2].map((index) => (
                  <span key={index} className="eve-post-row eve-post-row--skeleton" />
                ))}
              </div>
            ) : upcoming.length === 0 ? (
              <p className="eve-dim eve-empty">
                Nada agendado para frente neste mês.
                {hasAccount ? ' Clique num dia do calendário para criar um post.' : ''}
              </p>
            ) : (
              <div className="eve-post-list">{upcoming.map(renderPostRow)}</div>
            )}
          </section>
        </aside>
      </div>

      {editor && (
        <PostEditor
          clients={clients}
          accounts={accounts}
          initial={editor.mode === 'edit' ? editor.post : null}
          defaultDate={editor.mode === 'new' ? editor.date : undefined}
          onClose={() => setEditor(null)}
          onSaved={() => {
            setEditor(null);
            refresh();
          }}
        />
      )}
    </div>
  );
}
