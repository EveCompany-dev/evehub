'use client';

import { targetLabel } from '@eve/connector-meta/shared';
import { strings, WidgetShell } from '@eve/ui';
import Link from 'next/link';
import { useCallback, useEffect, useState, type JSX } from 'react';
import { PlatformIcon } from '../components/PlatformIcon';
import type { ScheduledPostRow } from '../components/scheduling-types';
import type { NotificationSummary } from '../components/notification-types';
import type { WidgetProps } from './types';

const POLL_INTERVAL_MS = 30_000;

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

/** Where a notification's own link goes — same rule NotificationBell uses, without the app-wide job/DM link falling through the bell's own component. */
function notificationHref(notification: NotificationSummary): string | null {
  if (notification.jobId) return `/jobs?job=${notification.jobId}`;
  if (notification.type === 'teamMessageMention' || notification.type === 'directMessage') return '/chat';
  if (notification.type === 'scheduledPostFailed') return '/scheduling';
  return null;
}

function todayRange(): { from: string; to: string } {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { from: start.toISOString(), to: end.toISOString() };
}

/**
 * Two independent lists, one widget: unread notifications (job importance,
 * chat/DM mentions, failed posts, ...) and today's Agenda — for now that's
 * just today's scheduled posts, the only thing the Agenda holds; generic
 * events/tags land there later and this widget picks them up without
 * changes, since it's reading the same "what's on today" question either way.
 * No sync — both lists are fetched straight from this app's own APIs on
 * mount and every POLL_INTERVAL_MS, same pattern as the notification bell.
 */
export function TodayWidget({ title, onRemove }: WidgetProps): JSX.Element {
  const [notifications, setNotifications] = useState<NotificationSummary[]>([]);
  const [posts, setPosts] = useState<ScheduledPostRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const { from, to } = todayRange();
      const [notificationsRes, postsRes] = await Promise.all([
        fetch('/api/notifications?limit=20', { cache: 'no-store' }),
        fetch(`/api/scheduling/posts?from=${from}&to=${to}`, { cache: 'no-store' }),
      ]);
      const notificationsBody = (await notificationsRes.json().catch(() => ({}))) as { notifications?: NotificationSummary[] };
      const postsBody = (await postsRes.json().catch(() => ({}))) as { posts?: ScheduledPostRow[] };

      if (notificationsRes.ok && notificationsBody.notifications) {
        setNotifications(notificationsBody.notifications.filter((notification) => !notification.readAt));
      }
      if (postsRes.ok && postsBody.posts) {
        setPosts([...postsBody.posts].sort((a, b) => a.scheduledFor.localeCompare(b.scheduledFor)));
      }
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // Mount fetch — same legitimate case as useWidgetData.ts's initial fetch.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
    const interval = setInterval(() => void load(), POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [load]);

  return (
    <WidgetShell title={title} status="ok" actions={[{ label: strings.dashboard.removeWidget, onSelect: onRemove, danger: true }]}>
      <div className="eve-no-drag eve-overview">
        {error && <p className="eve-alert eve-alert--error">{error}</p>}
        {loading ? (
          <p className="eve-dim">carregando...</p>
        ) : (
          <>
            <section className="eve-overview__section">
              <h4 className="eve-overview__title">Notificações</h4>
              {notifications.length === 0 ? (
                <p className="eve-dim">Nenhuma notificação pendente.</p>
              ) : (
                <ul className="eve-overview__list">
                  {notifications.map((notification) => {
                    const href = notificationHref(notification);
                    const content = <p className="eve-overview__item-text">{notification.message}</p>;
                    return (
                      <li key={notification.id} className="eve-overview__item">
                        {href ? (
                          <Link href={href} className="eve-overview__item-link">
                            {content}
                          </Link>
                        ) : (
                          content
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>

            <section className="eve-overview__section">
              <h4 className="eve-overview__title">Agenda de hoje</h4>
              {posts.length === 0 ? (
                <p className="eve-dim">Nada agendado para hoje.</p>
              ) : (
                <ul className="eve-overview__list">
                  {posts.map((post) => (
                    <li key={post.id} className="eve-overview__item">
                      <Link href={`/scheduling?post=${post.id}`} className="eve-overview__item-link eve-overview__agenda-row">
                        <PlatformIcon platform={post.platform} size={16} />
                        <span className="eve-overview__item-text">
                          {targetLabel({ platform: post.platform, postType: post.postType })} · {post.clientLabel}
                        </span>
                        <span className="eve-dim">{formatTime(post.scheduledFor)}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </>
        )}
      </div>
    </WidgetShell>
  );
}
