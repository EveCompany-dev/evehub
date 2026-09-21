'use client';

import { Settings, strings } from '@eve/ui';
import Link from 'next/link';
import type { JSX } from 'react';

function GearIcon(): JSX.Element {
  return <Settings size={18} aria-hidden="true" />;
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
