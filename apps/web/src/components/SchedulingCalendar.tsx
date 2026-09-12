'use client';

import { useCallback, useEffect, useMemo, useState, type JSX } from 'react';
import { MonthGrid } from './MonthGrid';
import { PostEditor } from './PostEditor';
import type { ClientOption, MetaAccount, ScheduledPostRow } from './scheduling-types';

interface NotionInstanceOption {
  id: string;
  label: string;
}

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
  const [notionInstances, setNotionInstances] = useState<NotionInstanceOption[]>([]);
  const [clientSourceInstanceId, setClientSourceInstanceId] = useState<string | null>(null);

  const [filterClient, setFilterClient] = useState('');
  const [filterPlatforms, setFilterPlatforms] = useState<Set<ScheduledPostRow['platform']>>(
    new Set(['instagram', 'facebook']),
  );
  const [editor, setEditor] = useState<EditorState>(null);
  const [error, setError] = useState<string | null>(null);

  const loadClients = useCallback(async () => {
    const response = await fetch('/api/scheduling/clients', { cache: 'no-store' });
    if (response.ok) setClients(((await response.json()) as { clients: ClientOption[] }).clients);
  }, []);

  const loadAccounts = useCallback(async () => {
    const response = await fetch('/api/scheduling/meta-accounts', { cache: 'no-store' });
    if (response.ok) setAccounts(((await response.json()) as { accounts: MetaAccount[] }).accounts);
  }, []);

  const loadSettings = useCallback(async () => {
    const response = await fetch('/api/scheduling/settings', { cache: 'no-store' });
    if (response.ok) {
      const body = (await response.json()) as { clientSourceInstanceId: string | null; notionInstances: NotionInstanceOption[] };
      setClientSourceInstanceId(body.clientSourceInstanceId);
      setNotionInstances(body.notionInstances);
    }
  }, []);

  const loadPosts = useCallback(async () => {
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
  }, [year, month, filterClient, filterPlatforms]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadClients();
    void loadAccounts();
    void loadSettings();
  }, [loadClients, loadAccounts, loadSettings]);

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

  const saveClientSource = async (value: string) => {
    const next = value || null;
    setClientSourceInstanceId(next);
    await fetch('/api/scheduling/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientSourceInstanceId: next }),
    });
    void loadClients();
  };

  return (
    <div className="eve-scheduling">
      <div className="eve-scheduling__filters eve-card">
        <label className="eve-field eve-scheduling__filter">
          <span className="eve-field__label">Cliente</span>
          <select className="eve-input" value={filterClient} onChange={(event) => setFilterClient(event.target.value)}>
            <option value="">Todos</option>
            {clients.map((client) => (
              <option key={`${client.source}:${client.id}`} value={`${client.source}:${client.id}`}>
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

        <label className="eve-field eve-scheduling__filter">
          <span className="eve-field__label">Fonte de clientes (Notion)</span>
          <select
            className="eve-input"
            value={clientSourceInstanceId ?? ''}
            onChange={(event) => void saveClientSource(event.target.value)}
          >
            <option value="">Nenhuma</option>
            {notionInstances.map((instance) => (
              <option key={instance.id} value={instance.id}>
                {instance.label}
              </option>
            ))}
          </select>
        </label>

        <button type="button" className="eve-btn eve-btn--primary" onClick={() => setEditor({ mode: 'new' })}>
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
        onDayClick={(date) => setEditor({ mode: 'new', date })}
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
                {PLATFORM_LABEL[post.platform]} · {post.clientLabel}
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
