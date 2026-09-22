'use client';

import { strings } from '@eve/ui';
import Link from 'next/link';
import { useCallback, useEffect, useState, type JSX } from 'react';
import { formatDateTimePtBr } from './job-types';
import { notificationHref, type NotificationSummary } from './notification-types';

const LIMIT = 150;

/** The full notification history — the bell dropdown only shows the last 30. */
export function NotificationsWorkspace(): JSX.Element {
  const [notifications, setNotifications] = useState<NotificationSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch(`/api/notifications?limit=${LIMIT}`, { cache: 'no-store' });
      const body = (await response.json().catch(() => ({}))) as { notifications?: NotificationSummary[]; error?: string };
      if (!response.ok || !body.notifications) {
        setError(body.error ?? `HTTP ${response.status}`);
        return;
      }
      setNotifications(body.notifications);
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
  }, [load]);

  const markRead = async (id: string) => {
    setNotifications((current) => current.map((item) => (item.id === id ? { ...item, readAt: new Date().toISOString() } : item)));
    try {
      await fetch(`/api/notifications/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ read: true }),
      });
    } catch {
      // Optimistic update stands; a reload reconciles if this failed.
    }
  };

  const markAllRead = async () => {
    setNotifications((current) => current.map((item) => ({ ...item, readAt: item.readAt ?? new Date().toISOString() })));
    try {
      await fetch('/api/notifications/read-all', { method: 'POST' });
    } catch {
      // Ignore — a reload reconciles.
    }
  };

  const unreadCount = notifications.filter((notification) => !notification.readAt).length;

  return (
    <div className="eve-notifications-page">
      {error && <p className="eve-alert eve-alert--error">{error}</p>}

      {unreadCount > 0 && (
        <div className="eve-notifications-page__head">
          <button type="button" className="eve-btn" onClick={() => void markAllRead()}>
            {strings.notifications.markAllRead}
          </button>
        </div>
      )}

      {loading ? (
        <p className="eve-dim">carregando...</p>
      ) : notifications.length === 0 ? (
        <div className="eve-empty">
          <p className="eve-dim">{strings.notifications.empty}</p>
        </div>
      ) : (
        <ul className="eve-notifications-page__list">
          {notifications.map((notification) => {
            const content = (
              <>
                <p className="eve-notifications-page__message">{notification.message}</p>
                <span className="eve-dim">{formatDateTimePtBr(notification.createdAt)}</span>
              </>
            );
            const href = notificationHref(notification);
            const itemClass = notification.readAt ? 'eve-notifications-page__item' : 'eve-notifications-page__item is-unread';
            const onOpen = () => {
              if (!notification.readAt) void markRead(notification.id);
            };

            return (
              <li key={notification.id} className={itemClass}>
                {href ? (
                  <Link href={href} className="eve-notifications-page__link" onClick={onOpen}>
                    {content}
                  </Link>
                ) : (
                  <button type="button" className="eve-notifications-page__link" onClick={onOpen}>
                    {content}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
