'use client';

import { strings } from '@eve/ui';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { JSX } from 'react';

function HomeIcon(): JSX.Element {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M4 11.5 12 4l8 7.5"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M6 10v9a1 1 0 0 0 1 1h3v-6h4v6h3a1 1 0 0 0 1-1v-9" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
    </svg>
  );
}

/**
 * Anchored to the rail like RailSettings, so the board is one click away
 * from every page instead of relying on the browser back button or Ctrl+K.
 */
export interface RailHomeProps {
  expanded: boolean;
}

export function RailHome({ expanded }: RailHomeProps): JSX.Element {
  const pathname = usePathname();
  const active = pathname === '/';

  return (
    <Link
      href="/"
      className={active ? 'eve-rail__item eve-rail__home is-active' : 'eve-rail__item eve-rail__home'}
      aria-current={active ? 'page' : undefined}
      aria-label={strings.dashboard.title}
      title={strings.dashboard.title}
    >
      <span className="eve-rail__icon">
        <HomeIcon />
      </span>
      {expanded && <span className="eve-rail__label">{strings.dashboard.title}</span>}
    </Link>
  );
}
