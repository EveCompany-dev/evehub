'use client';

import { House, strings } from '@eve/ui';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { JSX } from 'react';

function HomeIcon(): JSX.Element {
  return <House size={18} aria-hidden="true" />;
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
