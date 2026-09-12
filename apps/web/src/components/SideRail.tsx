'use client';

import { strings } from '@eve/ui';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState, type JSX, type ReactNode } from 'react';

interface RailItem {
  href: string;
  label: string;
  icon: ReactNode;
}

export interface SideRailProps {
  isOwner: boolean;
  isSocialMedia: boolean;
}

const STORAGE_KEY = 'eve.rail.expanded';

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
export function SideRail({ isOwner, isSocialMedia }: SideRailProps): JSX.Element {
  const pathname = usePathname();
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    // Mount-time read of an external system (localStorage) — the same
    // legitimate case documented in useWidgetData.ts's initial fetch.
    try {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setExpanded(localStorage.getItem(STORAGE_KEY) === '1');
    } catch {
      // Private window / blocked storage: stay collapsed.
    }
  }, []);

  useEffect(() => {
    document.body.dataset.rail = expanded ? 'expanded' : 'collapsed';
    return () => {
      delete document.body.dataset.rail;
    };
  }, [expanded]);

  const toggle = () => {
    setExpanded((value) => {
      const next = !value;
      try {
        localStorage.setItem(STORAGE_KEY, next ? '1' : '0');
      } catch {
        // Ignore: the toggle still works for this page view.
      }
      return next;
    });
  };

  const items: RailItem[] = [
    { href: '/tables', label: strings.nav.tables, icon: <TablesIcon /> },
    { href: '/automations', label: strings.nav.automations, icon: <AutomationsIcon /> },
    ...(isOwner || isSocialMedia
      ? [{ href: '/scheduling', label: strings.nav.scheduling, icon: <SchedulingIcon /> }]
      : []),
    ...(isOwner ? [{ href: '/financial', label: strings.nav.financial, icon: <FinancialIcon /> }] : []),
    ...(isOwner ? [{ href: '/team', label: strings.nav.team, icon: <TeamIcon /> }] : []),
  ];

  return (
    <nav className={expanded ? 'eve-rail is-expanded' : 'eve-rail'} aria-label={strings.rail.navLabel}>
      <button
        type="button"
        className="eve-rail__toggle"
        onClick={toggle}
        aria-expanded={expanded}
        aria-label={expanded ? strings.rail.collapse : strings.rail.expand}
        title={expanded ? strings.rail.collapse : strings.rail.expand}
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

      {items.map((item) => {
        const active = pathname.startsWith(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            className={active ? 'eve-rail__item is-active' : 'eve-rail__item'}
            aria-current={active ? 'page' : undefined}
            title={item.label}
          >
            <span className="eve-rail__icon">{item.icon}</span>
            {expanded && <span className="eve-rail__label">{item.label}</span>}
          </Link>
        );
      })}
    </nav>
  );
}
