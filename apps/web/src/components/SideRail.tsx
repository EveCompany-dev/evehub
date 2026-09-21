'use client';

import { CalendarDays, ChevronLeft, Wrench, ChevronRight, ChevronDown, CircleDollarSign, IdCard, MessageCircle, SquareKanban, strings, Table2, Users } from '@eve/ui';
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

function FinancialIcon(): JSX.Element {
  return <CircleDollarSign size={18} aria-hidden="true" />;
}

function ClientsIcon(): JSX.Element {
  return <IdCard size={18} aria-hidden="true" />;
}

/** Rail entries that open a dropdown of sub-pages instead of linking straight to one. */
interface RailGroupItem {
  href: string;
  label: string;
  /** Tab that gates this entry; a group with no visible entry disappears from the rail. */
  tab?: string;
}

const GROUPS: Record<string, { alsoActive?: string[]; items: RailGroupItem[] }> = {
  '/agenda': {
    items: [
      { href: '/agenda?mine=1', label: 'Minha Agenda' },
      { href: '/agenda', label: 'Time' },
    ],
  },
  '/clients': {
    items: [
      { href: '/clients', label: 'Todos os clientes' },
      { href: '/clients/calendar', label: 'Calendário de Conteúdo' },
    ],
  },
  // Not a page of its own: a drawer for the working tools that used to sit loose in the rail.
  '/tools': {
    items: [
      { href: '/scheduling?new=1', label: 'Agendar Post', tab: 'scheduling' },
      { href: '/automations', label: 'Automações', tab: 'automations' },
    ],
  },
};

/** The path prefix a group entry lives under, for the rail highlight ("/scheduling?new=1" -> "/scheduling"). */
function pathOf(href: string): string {
  return href.split('?')[0]!;
}

function TeamIcon(): JSX.Element {
  return <Users size={18} aria-hidden="true" />;
}

function TablesIcon(): JSX.Element {
  return <Table2 size={18} aria-hidden="true" />;
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
    '/tools': <Wrench size={18} aria-hidden="true" />,
    // Not '/scheduling' — that's the post-scheduler *tool*, reachable only
    // from inside the Agenda dropdown below, not its own top-level rail icon.
    '/agenda': <SchedulingIcon />,
    '/financial': <FinancialIcon />,
    '/team': <TeamIcon />,
  };

  // The rail shows only the tab-gated workspaces, not every indexed route:
  // dashboard/perfil/settings/notifications already have their own fixed
  // affordances (home, avatar, gear, bell).
  const baseItems = visibleRoutes(visibleTabs).filter((route) => route.tab && icons[route.href]);
  // "Tools" isn't a route: it sits right after Tabelas, and only when the user can open something inside it.
  const toolsItems = GROUPS['/tools']!.items.filter((entry) => !entry.tab || visibleTabs.includes(entry.tab));
  const tablesAt = baseItems.findIndex((route) => route.href === '/tables');
  const items =
    toolsItems.length > 0
      ? [...baseItems.slice(0, tablesAt + 1), { href: '/tools', label: 'Tools' }, ...baseItems.slice(tablesAt + 1)]
      : baseItems;

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
        const group = GROUPS[item.href];
        const active = group
          ? group.items.some((entry) => pathname.startsWith(pathOf(entry.href)) && (entry.href !== '/clients' || pathname === '/clients' || !pathname.startsWith('/clients/calendar')))
          : pathname.startsWith(item.href);
        if (group) {
          const groupActive = active || (item.href === '/clients' && pathname.startsWith('/clients'));
          const visibleEntries = group.items.filter((entry) => !entry.tab || visibleTabs.includes(entry.tab));
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
                  if (!expanded) router.push(visibleEntries[0]?.href ?? item.href);
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
                  {visibleEntries.map((sub) => (
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
