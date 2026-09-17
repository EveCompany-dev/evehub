'use client';

import { strings } from '@eve/ui';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState, type JSX } from 'react';
import { createPortal } from 'react-dom';
import { formatDateTimePtBr } from './job-types';
import type { NotificationSummary, NotificationType } from './notification-types';

const POLL_INTERVAL_MS = 45_000;

// Every new notification gets the sound cue — it's quiet enough not to be
// annoying. Only these types are worth the more intrusive desktop popup;
// everything else just raises the badge count (plus the chime) quietly.
// A failed post is time-critical in a way the others aren't — the publish
// window is already gone, so it earns the popup too.
const DESKTOP_ALERT_TYPES: NotificationType[] = ['markedImportant', 'teamMessageMention', 'scheduledPostFailed'];

/**
 * A short two-tone chime via Web Audio, rather than bundling an audio file —
 * one less binary asset to ship and license. Browsers block audio (and, on
 * some, the desktop Notification popup) until the user has interacted with
 * the page at least once in the tab's lifetime; that's a browser autoplay
 * policy, not something this code can bypass.
 */
function playAlertChime(): void {
  try {
    const ctx = new AudioContext();
    const now = ctx.currentTime;
    [880, 1320].forEach((freq, index) => {
      const start = now + index * 0.12;
      const oscillator = ctx.createOscillator();
      const gain = ctx.createGain();
      oscillator.type = 'sine';
      oscillator.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.2, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.25);
      oscillator.connect(gain).connect(ctx.destination);
      oscillator.start(start);
      oscillator.stop(start + 0.3);
    });
    setTimeout(() => void ctx.close(), 600);
  } catch {
    // Web Audio unsupported or blocked — a missed chime isn't worth surfacing an error for.
  }
}

/**
 * Desktop notification while the tab is open — NOT a real Web Push
 * subscription (that needs a service worker + VAPID keys + a per-user
 * subscription store, a materially bigger project). Only shows one if
 * permission is already granted; requesting permission happens separately,
 * from the bell's own click handler (see requestNotificationPermission
 * below) — modern Chrome silently ignores requestPermission() calls that
 * aren't triggered by a real user gesture, so calling it from here (a timer
 * callback) would never actually prompt anyone.
 */
function notifyDesktop(message: string): void {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  try {
    new Notification('Eve Hub', { body: message, icon: '/brand/eve-icon-orange.jpg' });
  } catch {
    // Some browsers still throw for reasons outside our control — ignore.
  }
}

/** Called from the bell's onClick — a real user gesture, so the browser will actually show the permission prompt. */
function requestNotificationPermission(): void {
  if ('Notification' in window && Notification.permission === 'default') {
    void Notification.requestPermission();
  }
}

function BellIcon(): JSX.Element {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M6 10a6 6 0 0 1 12 0v4.5l1.6 2.4a.6.6 0 0 1-.5.9H4.9a.6.6 0 0 1-.5-.9L6 14.5V10Z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <path d="M9.5 20a2.5 2.5 0 0 0 5 0" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

/**
 * Lives in the side rail so it's on every authenticated page — the same
 * reasoning as the site-wide timer popup. Polls rather than pushing over the
 * existing SSE connector-event stream, since notifications are a distinct,
 * low-frequency concern not worth coupling to that channel.
 */
export interface NotificationBellProps {
  expanded: boolean;
}

export function NotificationBell({ expanded }: NotificationBellProps): JSX.Element {
  const [notifications, setNotifications] = useState<NotificationSummary[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [open, setOpen] = useState(false);
  // Where to render the portal-ed panel (see the render below for why this
  // isn't just CSS `position: absolute` anymore).
  const [panelPos, setPanelPos] = useState<{ top: number; right: number } | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  // null until the first poll completes — that first poll only seeds this
  // set silently, so refreshing the page never re-alerts for things that
  // were already there before this tab opened.
  const seenIdsRef = useRef<Set<string> | null>(null);

  const load = useCallback(async () => {
    try {
      const response = await fetch('/api/notifications', { cache: 'no-store' });
      const body = (await response.json().catch(() => ({}))) as {
        notifications?: NotificationSummary[];
        unreadCount?: number;
      };
      if (!response.ok) return;
      const list = body.notifications ?? [];

      if (seenIdsRef.current) {
        const newItems = list.filter((item) => !item.readAt && !seenIdsRef.current!.has(item.id));
        // One chime per poll cycle is enough even if several arrived at once —
        // a burst of separate beeps reads as broken, not helpful.
        if (newItems.length > 0) playAlertChime();
        newItems.filter((item) => DESKTOP_ALERT_TYPES.includes(item.type)).forEach((item) => notifyDesktop(item.message));
      }
      seenIdsRef.current = new Set(list.map((item) => item.id));

      setNotifications(list);
      setUnreadCount(body.unreadCount ?? 0);
    } catch {
      // Non-critical — the badge just won't update until the next poll.
    }
  }, []);

  useEffect(() => {
    // Mount fetch — setState happens after an await, same case as
    // useWidgetData.ts's initial fetch.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
    const interval = setInterval(() => void load(), POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [load]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      // The panel is portal-ed to document.body (see below), so it's no
      // longer a DOM descendant of `ref` — it needs its own containment check.
      if (ref.current?.contains(target) || panelRef.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [open]);

  const toggleOpen = () => {
    requestNotificationPermission();
    if (!open && triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect();
      setPanelPos({ top: rect.top, right: window.innerWidth - rect.left + 8 });
    }
    setOpen((value) => !value);
  };

  const markRead = async (id: string) => {
    setNotifications((current) => current.map((item) => (item.id === id ? { ...item, readAt: new Date().toISOString() } : item)));
    setUnreadCount((current) => Math.max(0, current - 1));
    try {
      await fetch(`/api/notifications/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ read: true }),
      });
    } catch {
      // Optimistic update stands; the next poll reconciles if this failed.
    }
  };

  const markAllRead = async () => {
    setNotifications((current) => current.map((item) => ({ ...item, readAt: item.readAt ?? new Date().toISOString() })));
    setUnreadCount(0);
    try {
      await fetch('/api/notifications/read-all', { method: 'POST' });
    } catch {
      // Ignore — next poll reconciles.
    }
  };

  return (
    <div className="eve-notif" ref={ref}>
      <button
        ref={triggerRef}
        type="button"
        className="eve-rail__item eve-notif__trigger"
        aria-label={strings.notifications.title}
        title={strings.notifications.title}
        onClick={toggleOpen}
      >
        <span className="eve-rail__icon">
          <BellIcon />
          {unreadCount > 0 && <span className="eve-notif__badge">{unreadCount > 9 ? '9+' : unreadCount}</span>}
        </span>
        {expanded && <span className="eve-rail__label">{strings.notifications.title}</span>}
      </button>

      {open &&
        panelPos &&
        createPortal(
          <div
            className="eve-notif__panel eve-notif__panel--portal"
            style={{ top: panelPos.top, right: panelPos.right }}
            role="menu"
            ref={panelRef}
          >
            <div className="eve-notif__panel-head">
              <strong>{strings.notifications.title}</strong>
              {unreadCount > 0 && (
                <button type="button" className="eve-btn" onClick={() => void markAllRead()}>
                  {strings.notifications.markAllRead}
                </button>
              )}
            </div>

            {notifications.length === 0 ? (
              <p className="eve-dim eve-notif__empty">{strings.notifications.empty}</p>
            ) : (
              <ul className="eve-notif__list">
                {notifications.map((notification) => {
                  const content = (
                    <>
                      <p className="eve-notif__message">{notification.message}</p>
                      <span className="eve-dim">{formatDateTimePtBr(notification.createdAt)}</span>
                    </>
                  );
                  return (
                    <li key={notification.id} className={notification.readAt ? 'eve-notif__item' : 'eve-notif__item is-unread'}>
                      {notification.jobId || notification.type === 'teamMessageMention' ? (
                        <Link
                          href={notification.jobId ? `/jobs?job=${notification.jobId}` : '/chat'}
                          className="eve-notif__link"
                          onClick={() => {
                            setOpen(false);
                            if (!notification.readAt) void markRead(notification.id);
                          }}
                        >
                          {content}
                        </Link>
                      ) : (
                        <div className="eve-notif__link">{content}</div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}

            <Link href="/notifications" className="eve-notif__viewall" onClick={() => setOpen(false)}>
              {strings.notifications.viewAll}
            </Link>
          </div>,
          document.body,
        )}
    </div>
  );
}
