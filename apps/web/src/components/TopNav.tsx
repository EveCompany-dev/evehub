'use client';

import { strings } from '@eve/ui';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { JSX } from 'react';

interface TopNavItem {
  href: string;
  label: string;
}

export interface TopNavProps {
  isOwner: boolean;
}

/**
 * Top-level tab bar, mounted once in RootLayout so it applies to every route
 * without duplicating it into each page's own header (DashboardShell, /perfil,
 * etc. keep their own page-specific header below this).
 */
export function TopNav({ isOwner }: TopNavProps): JSX.Element {
  const pathname = usePathname();

  const items: TopNavItem[] = [
    { href: '/', label: strings.nav.dashboard },
    { href: '/automations', label: strings.nav.automations },
    ...(isOwner ? [{ href: '/financial', label: strings.nav.financial }] : []),
    ...(isOwner ? [{ href: '/team', label: strings.nav.team }] : []),
  ];

  return (
    <nav className="eve-topnav" aria-label={strings.nav.dashboard}>
      {items.map((item) => {
        const active = item.href === '/' ? pathname === '/' : pathname.startsWith(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            className={active ? 'eve-topnav__item is-active' : 'eve-topnav__item'}
            aria-current={active ? 'page' : undefined}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
