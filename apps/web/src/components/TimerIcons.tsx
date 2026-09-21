import type { JSX } from 'react';
import { ChevronLeft, ChevronRight, Pause, Play } from '@eve/ui';

export function PlayIcon(): JSX.Element {
  return <Play size={14} fill="currentColor" aria-hidden="true" />;
}

export function PauseIcon(): JSX.Element {
  return <Pause size={14} fill="currentColor" aria-hidden="true" />;
}

/** Doubles as the floating timer's drag handle and its collapse/expand toggle — chevron direction mirrors the side rail's own expand/collapse arrow for consistency. */
export function CollapseIcon({ collapsed }: { collapsed: boolean }): JSX.Element {
  return collapsed ? <ChevronRight size={12} aria-hidden="true" /> : <ChevronLeft size={12} aria-hidden="true" />;
}
