'use client';

import { strings } from '@eve/ui';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState, type JSX, type ReactNode } from 'react';
import { visibleRoutes } from '../lib/navigation';
import { NotificationBell } from './NotificationBell';
import { RailHome } from './RailHome';
import { RailSettings } from './RailSettings';

export interface SideRailProps {
  /** Computed server-side via getVisibleTabs() — owner already has every tab in here. */
  visibleTabs: string[];
  /** From dashboardConfig.railFullHide — changes what the arrow does (see toggle()). */
  railFullHide: boolean;
}

const STORAGE_KEY_EXPANDED = 'eve.rail.expanded';
const STORAGE_KEY_HIDDEN = 'eve.rail.hidden';

function ChevronDownIcon(): JSX.Element {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function AutomationsIcon(): JSX.Element {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M4 12a8 8 0 0 1 8-8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <path d="M20 12a8 8 0 0 1-8 8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <path d="M9 3l3 1-1 3M15 21l-3-1 1-3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function FinancialIcon(): JSX.Element {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" />
      <path
        d="M15 9.5c0-1.1-1.34-2-3-2s-3 .9-3 2c0 3 6 1.5 6 4.5 0 1.1-1.34 2-3 2s-3-.9-3-2M12 6v1.3M12 16.7V18"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}

function TeamIcon(): JSX.Element {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="9" cy="8" r="3" stroke="currentColor" strokeWidth="2" />
      <path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <circle cx="17" cy="7" r="2.4" stroke="currentColor" strokeWidth="1.6" />
      <path d="M15.5 13.2c2.6.4 4.5 2.6 4.5 5.3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

function TablesIcon(): JSX.Element {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="3.5" y="4.5" width="17" height="15" rx="2" stroke="currentColor" strokeWidth="2" />
      <path d="M3.5 9.5h17M9.5 9.5v10" stroke="currentColor" strokeWidth="2" />
    </svg>
  );
}

function ConnectorsIcon(): JSX.Element {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="4" y="8" width="16" height="12" rx="2.5" stroke="currentColor" strokeWidth="1.8" />
      <path d="M9 8V5M15 8V5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <circle cx="12" cy="14" r="2" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  );
}

function ChatIcon(): JSX.Element {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M4 6.5A2.5 2.5 0 0 1 6.5 4h11A2.5 2.5 0 0 1 20 6.5v7A2.5 2.5 0 0 1 17.5 16H10l-4.5 4v-4H6.5A2.5 2.5 0 0 1 4 13.5v-7Z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <path d="M8 9h8M8 12h5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

function JobsIcon(): JSX.Element {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="3.5" y="5.5" width="6" height="4.5" rx="1.2" stroke="currentColor" strokeWidth="1.8" />
      <rect x="9.5" y="10.5" width="6" height="4.5" rx="1.2" stroke="currentColor" strokeWidth="1.8" />
      <rect x="15.5" y="15.5" width="5" height="4.2" rx="1.2" stroke="currentColor" strokeWidth="1.8" />
      <path d="M9.5 7.7h4M14.5 12.7h3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function SchedulingIcon(): JSX.Element {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="3.5" y="5" width="17" height="15" rx="2" stroke="currentColor" strokeWidth="2" />
      <path d="M3.5 9.5h17M8 3v4M16 3v4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <circle cx="8" cy="14" r="1.2" fill="currentColor" />
      <circle cx="12" cy="14" r="1.2" fill="currentColor" />
      <circle cx="16" cy="14" r="1.2" fill="currentColor" />
    </svg>
  );
}

/**
 * Secondary navigation, off to the right so the main dashboard reads as the
 * simple/default view and the more advanced sections stay one click away
 * instead of competing for attention in a top bar. Collapsed to icons by
 * default; the arrow expands it to icons+labels. Open/closed is a per-viewer
 * convenience (localStorage), not shared dashboard state.
 */
export function SideRail({ visibleTabs, railFullHide }: SideRailProps): JSX.Element {
  const pathname = usePathname();
  const [expanded, setExpanded] = useState(false);
  const [hidden, setHidden] = useState(false);
  const [agendaOpen, setAgendaOpen] = useState(false);
  const router = useRouter();

  useEffect(() => {
    // Mount-time read of an external system (localStorage) — the same
    // legitimate case documented in useWidgetData.ts's initial fetch.
    try {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setExpanded(localStorage.getItem(STORAGE_KEY_EXPANDED) === '1');
      setHidden(localStorage.getItem(STORAGE_KEY_HIDDEN) === '1');
    } catch {
      // Private window / blocked storage: stay collapsed/visible.
    }
  }, []);

  const fullyHidden = railFullHide && hidden;

  useEffect(() => {
    document.body.dataset.rail = fullyHidden ? 'hidden' : expanded ? 'expanded' : 'collapsed';
    return () => {
      delete document.body.dataset.rail;
    };
  }, [expanded, fullyHidden]);

  /** In normal mode the arrow toggles icon-only vs icon+label; when the "hide completely" setting is on, it hides/shows the whole rail instead. */
  const toggle = () => {
    if (railFullHide) {
      setHidden((value) => {
        const next = !value;
        try {
          localStorage.setItem(STORAGE_KEY_HIDDEN, next ? '1' : '0');
        } catch {
          // Ignore: the toggle still works for this page view.
        }
        return next;
      });
      return;
    }
    setExpanded((value) => {
      const next = !value;
      try {
        localStorage.setItem(STORAGE_KEY_EXPANDED, next ? '1' : '0');
      } catch {
        // Ignore: the toggle still works for this page view.
      }
      return next;
    });
  };

  // Labels, hrefs and tab gating come from lib/navigation.ts, which the
  // Ctrl+K palette indexes from the same list; only the icons live here.
  const icons: Record<string, ReactNode> = {
    '/chat': <ChatIcon />,
    '/jobs': <JobsIcon />,
    '/tables': <TablesIcon />,
    '/connectors': <ConnectorsIcon />,
    '/automations': <AutomationsIcon />,
    // Not '/scheduling' — that's the post-scheduler *tool*, reachable only
    // from inside the Agenda dropdown below, not its own top-level rail icon.
    '/agenda': <SchedulingIcon />,
    '/financial': <FinancialIcon />,
    '/team': <TeamIcon />,
  };

  // The rail shows only the tab-gated workspaces, not every indexed route:
  // dashboard/perfil/settings/notifications already have their own fixed
  // affordances (home, avatar, gear, bell).
  const items = visibleRoutes(visibleTabs).filter((route) => route.tab && icons[route.href]);

  if (fullyHidden) {
    return (
      <button
        type="button"
        className="eve-rail__show-tab"
        onClick={toggle}
        aria-label={strings.rail.expand}
        title={strings.rail.expand}
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M14 6l-6 6 6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
    );
  }

  return (
    <nav className={expanded ? 'eve-rail is-expanded' : 'eve-rail'} aria-label={strings.rail.navLabel}>
      <button
        type="button"
        className="eve-rail__toggle"
        onClick={toggle}
        aria-expanded={railFullHide ? !hidden : expanded}
        aria-label={railFullHide ? strings.rail.collapse : expanded ? strings.rail.collapse : strings.rail.expand}
        title={railFullHide ? strings.rail.collapse : expanded ? strings.rail.collapse : strings.rail.expand}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path
            d={expanded ? 'M14 6l-6 6 6 6' : 'M10 6l6 6-6 6'}
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>

      <RailHome expanded={expanded} />

      <NotificationBell expanded={expanded} />

      {items.map((item) => {
        const active = pathname.startsWith(item.href);

        if (item.href === '/agenda') {
          // Active on both /agenda (the real agenda) and /scheduling (the
          // post-scheduler tool reached only from inside this dropdown) —
          // they're the same feature area as far as the rail highlight goes.
          const agendaActive = active || pathname.startsWith('/scheduling');
          return (
            <div key={item.href} className="eve-rail__group">
              <button
                type="button"
                className={agendaActive ? 'eve-rail__item eve-rail__group-trigger is-active' : 'eve-rail__item eve-rail__group-trigger'}
                aria-expanded={agendaOpen}
                title={item.label}
                onClick={() => {
                  // Collapsed rail has no room to show sub-item labels, so a
                  // click there just goes straight to the page instead of
                  // toggling an invisible dropdown.
                  if (!expanded) router.push('/agenda');
                  else setAgendaOpen((value) => !value);
                }}
              >
                <span className="eve-rail__icon">{icons[item.href]}</span>
                {expanded && (
                  <>
                    <span className="eve-rail__label">{item.label}</span>
                    <span className={agendaOpen ? 'eve-rail__chevron is-open' : 'eve-rail__chevron'} aria-hidden="true">
                      <ChevronDownIcon />
                    </span>
                  </>
                )}
              </button>

              {expanded && agendaOpen && (
                <div className="eve-rail__submenu">
                  <Link href="/agenda?mine=1" className="eve-rail__subitem">
                    Minha Agenda
                  </Link>
                  <Link href="/scheduling?new=1" className="eve-rail__subitem">
                    Agendar Post
                  </Link>
                  <Link href="/agenda" className="eve-rail__subitem">
                    Time
                  </Link>
                </div>
              )}
            </div>
          );
        }

        return (
          <Link
            key={item.href}
            href={item.href}
            className={active ? 'eve-rail__item is-active' : 'eve-rail__item'}
            aria-current={active ? 'page' : undefined}
            title={item.label}
          >
            <span className="eve-rail__icon">{icons[item.href]}</span>
            {expanded && <span className="eve-rail__label">{item.label}</span>}
          </Link>
        );
      })}

      <RailSettings expanded={expanded} />
    </nav>
  );
}
