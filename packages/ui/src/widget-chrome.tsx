'use client';

import { createContext, useContext, type ComponentType } from 'react';
import type { LucideProps } from 'lucide-react';

/**
 * What the dashboard grid knows about a tile that the widget inside it does
 * not: its icon, whether it is locked in place, and how to take it off the
 * board. The grid provides this around every widget, so WidgetShell's
 * settings card offers lock/unlock and "Remover do painel" on every widget
 * without each one wiring them through its own props.
 */
export interface WidgetChrome {
  icon?: ComponentType<LucideProps>;
  locked?: boolean;
  onToggleLock?: () => void;
  onRemove?: () => void;
}

export const WidgetChromeContext = createContext<WidgetChrome | null>(null);

export function useWidgetChrome(): WidgetChrome {
  return useContext(WidgetChromeContext) ?? {};
}
