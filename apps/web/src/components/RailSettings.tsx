'use client';

import { strings } from '@eve/ui';
import Link from 'next/link';
import type { JSX } from 'react';

function GearIcon(): JSX.Element {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="2" />
      <path
        d="M19.4 13a7.97 7.97 0 0 0 0-2l2.03-1.58a.5.5 0 0 0 .12-.64l-1.92-3.32a.5.5 0 0 0-.6-.22l-2.39.96a7.9 7.9 0 0 0-1.73-1l-.36-2.54a.5.5 0 0 0-.5-.43h-3.84a.5.5 0 0 0-.5.43l-.36 2.54a7.9 7.9 0 0 0-1.73 1l-2.39-.96a.5.5 0 0 0-.6.22L2.7 8.78a.5.5 0 0 0 .12.64L4.85 11a7.97 7.97 0 0 0 0 2l-2.03 1.58a.5.5 0 0 0-.12.64l1.92 3.32a.5.5 0 0 0 .6.22l2.39-.96a7.9 7.9 0 0 0 1.73 1l.36 2.54a.5.5 0 0 0 .5.43h3.84a.5.5 0 0 0 .5-.43l.36-2.54a7.9 7.9 0 0 0 1.73-1l2.39.96a.5.5 0 0 0 .6-.22l1.92-3.32a.5.5 0 0 0-.12-.64L19.4 13Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/**
 * Global settings entry point, anchored to the rail instead of a floating
 * pill on the dashboard — it edits the same per-user dashboardConfig, so it
 * belongs somewhere reachable from every page, not just "/". Navigates to
 * the full `/settings` page (categories in a side nav) rather than opening
 * an inline popover — a gear icon in a 40px-wide rail is easy to miss was
 * ever clicked when the only feedback is a small flyout.
 */
export interface RailSettingsProps {
  expanded: boolean;
}

export function RailSettings({ expanded }: RailSettingsProps): JSX.Element {
  return (
    <Link
      href="/settings"
      className="eve-rail__item eve-rail__settings"
      aria-label={strings.dock.settingsTitle}
      title={strings.dock.settingsTitle}
    >
      <span className="eve-rail__icon">
        <GearIcon />
      </span>
      {expanded && <span className="eve-rail__label">{strings.dock.settingsTitle}</span>}
    </Link>
  );
}
