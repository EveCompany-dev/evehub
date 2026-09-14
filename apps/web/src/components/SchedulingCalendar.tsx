'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState, type JSX } from 'react';
import { MonthGrid } from './MonthGrid';
import { PostEditor } from './PostEditor';
import type { ClientOption, MetaAccount, ScheduledPostRow } from './scheduling-types';

type EditorState = { mode: 'new'; date?: Date } | { mode: 'edit'; post: ScheduledPostRow } | null;

const PLATFORM_LABEL: Record<ScheduledPostRow['platform'], string> = { instagram: 'IG', facebook: 'FB' };

function isoDateOnly(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function SchedulingCalendar(): JSX.Element {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth());

  const [clients, setClients] = useState<ClientOption[]>([]);
  const [accounts, setAccounts] = useState<MetaAccount[]>([]);
  const [posts, setPosts] = useState<ScheduledPostRow[]>([]);
  const [loading, setLoading] = useState(true);

  const [filterClient, setFilterClient] = useState('');
  const [filterPlatforms, setFilterPlatforms] = useState<Set<ScheduledPostRow['platform']>>(
    new Set(['instagram', 'facebook']),
  );
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
    try {
      const from = new Date(year, month, 1);
      const to = new Date(year, month + 1, 0, 23, 59, 59);
      const params = new URLSearchParams({ from: from.toISOString(), to: to.toISOString() });
      if (filterClient) params.set('client', filterClient);

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
    }
  }, [year, month, filterClient, filterPlatforms]);

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

  const togglePlatform = (platform: ScheduledPostRow['platform']) => {
    setFilterPlatforms((current) => {
      const next = new Set(current);
      if (next.has(platform)) next.delete(platform);
      else next.add(platform);
      return next;
    });
  };

  const hasAccount = accounts.length > 0;

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
          <label className="eve-check">
            <input
              type="checkbox"
              checked={filterPlatforms.has('instagram')}
              onChange={() => togglePlatform('instagram')}
            />
            <span>Instagram</span>
          </label>
          <label className="eve-check">
            <input type="checkbox" checked={filterPlatforms.has('facebook')} onChange={() => togglePlatform('facebook')} />
            <span>Facebook</span>
          </label>
        </div>

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
                title={post.caption}
              >
                {PLATFORM_LABEL[post.platform]}
                {post.postType === 'story' ? ' · story' : ''} · {post.clientLabel}
              </button>
            ))}
          </div>
        )}
      />

      {editor && (
        <PostEditor
          clients={clients}
          accounts={accounts}
          initial={editor.mode === 'edit' ? editor.post : null}
          defaultDate={editor.mode === 'new' ? editor.date : undefined}
          onClose={() => setEditor(null)}
          onSaved={() => {
            setEditor(null);
            void loadPosts();
          }}
        />
      )}
    </div>
  );
}
