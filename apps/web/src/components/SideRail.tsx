'use client';

import { CalendarDays, ChevronLeft, ChevronRight, ChevronDown, CircleDollarSign, IdCard, MessageCircle, Plug, SquareKanban, strings, Table2, Users, Zap } from '@eve/ui';
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
  return <ChevronDown size={12} aria-hidden="true" />;
}

function AutomationsIcon(): JSX.Element {
  return <Zap size={18} aria-hidden="true" />;
}

function FinancialIcon(): JSX.Element {
  return <CircleDollarSign size={18} aria-hidden="true" />;
}

function ClientsIcon(): JSX.Element {
  return <IdCard size={18} aria-hidden="true" />;
}

/** Rail entries that open a dropdown of sub-pages instead of linking straight to one. */
const GROUPS: Record<string, { alsoActive?: string[]; items: { href: string; label: string }[] }> = {
  '/agenda': {
    alsoActive: ['/scheduling'],
    items: [
      { href: '/agenda?mine=1', label: 'Minha Agenda' },
      { href: '/scheduling?new=1', label: 'Agendar Post' },
      { href: '/agenda', label: 'Time' },
    ],
  },
  '/clients': {
    items: [
      { href: '/clients', label: 'Todos os clientes' },
      { href: '/clients/calendar', label: 'Calendário de Conteúdo' },
    ],
  },
};

function TeamIcon(): JSX.Element {
  return <Users size={18} aria-hidden="true" />;
}

function TablesIcon(): JSX.Element {
  return <Table2 size={18} aria-hidden="true" />;
}

function ConnectorsIcon(): JSX.Element {
  return <Plug size={18} aria-hidden="true" />;
}

function ChatIcon(): JSX.Element {
  return <MessageCircle size={18} aria-hidden="true" />;
}

function JobsIcon(): JSX.Element {
  return <SquareKanban size={18} aria-hidden="true" />;
}

function SchedulingIcon(): JSX.Element {
  return <CalendarDays size={18} aria-hidden="true" />;
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
  const [openGroup, setOpenGroup] = useState<string | null>(null);
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
    '/clients': <ClientsIcon />,
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
        <ChevronLeft size={12} aria-hidden="true" />
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
        {expanded ? <ChevronLeft size={14} aria-hidden="true" /> : <ChevronRight size={14} aria-hidden="true" />}
      </button>

      <RailHome expanded={expanded} />

      <NotificationBell expanded={expanded} />

      {items.map((item) => {
        const active = pathname.startsWith(item.href);

        const group = GROUPS[item.href];
        if (group) {
          // Active on the group's own pages and on any tool page reached only from inside its
          // dropdown (e.g. /scheduling under Agenda): same feature area as far as the highlight goes.
          const groupActive = active || (group.alsoActive ?? []).some((prefix) => pathname.startsWith(prefix));
          const isOpen = openGroup === item.href;
          return (
            <div key={item.href} className="eve-rail__group">
              <button
                type="button"
                className={groupActive ? 'eve-rail__item eve-rail__group-trigger is-active' : 'eve-rail__item eve-rail__group-trigger'}
                aria-expanded={isOpen}
                title={item.label}
                onClick={() => {
                  // Collapsed rail has no room to show sub-item labels, so a
                  // click there just goes straight to the page instead of
                  // toggling an invisible dropdown.
                  if (!expanded) router.push(item.href);
                  else setOpenGroup(isOpen ? null : item.href);
                }}
              >
                <span className="eve-rail__icon">{icons[item.href]}</span>
                {expanded && (
                  <>
                    <span className="eve-rail__label">{item.label}</span>
                    <span className={isOpen ? 'eve-rail__chevron is-open' : 'eve-rail__chevron'} aria-hidden="true">
                      <ChevronDownIcon />
                    </span>
                  </>
                )}
              </button>

              {expanded && isOpen && (
                <div className="eve-rail__submenu">
                  {group.items.map((sub) => (
                    <Link key={sub.label} href={sub.href} className="eve-rail__subitem">
                      {sub.label}
                    </Link>
                  ))}
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
