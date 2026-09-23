import { Fragment, isValidElement, type ReactNode } from 'react';

/**
 * The pages a widget's settings card (⋮) can have, in the order the side list
 * shows them:
 *
 *   geral    what is specific to this widget (Pomodoro, the fields a table
 *            shows, which to-do list...)
 *   estilo   appearance
 *   conexao  which client / connected account the widget reads from — a
 *            placeholder today, for modules like the future GTM panel
 *
 * A widget opts into a page just by passing content for it. The lock / sync /
 * undo / remove actions are not a page: every widget gets them in the card's
 * footer.
 */
export const WIDGET_SETTINGS_PAGES = ['geral', 'estilo', 'conexao'] as const;
export type WidgetSettingsPageId = (typeof WIDGET_SETTINGS_PAGES)[number];

export type WidgetSettingsPages = Partial<Record<WidgetSettingsPageId, ReactNode>>;

/**
 * Whether a node would put anything on screen, as far as it can be told
 * without rendering it: null/undefined/booleans/blank strings and fragments
 * or arrays made only of those count as empty. A component element always
 * counts as content — only rendering it could say otherwise.
 */
export function hasRenderableContent(node: ReactNode): boolean {
  if (node === null || node === undefined || typeof node === 'boolean') return false;
  if (typeof node === 'string') return node.trim().length > 0;
  if (typeof node === 'number' || typeof node === 'bigint') return true;
  if (Array.isArray(node)) return node.some((child: ReactNode) => hasRenderableContent(child));
  if (isValidElement(node)) {
    if (node.type === Fragment) return hasRenderableContent((node.props as { children?: ReactNode }).children);
    return true;
  }
  // Iterables other than arrays, portals, promises: assume they render.
  return true;
}

/**
 * The pages the card lists, in order. A page with nothing in it is left out.
 * `legacyActionCount` covers widgets still passing the old `actions` menu:
 * those items render on the Geral page, so it shows even when empty.
 */
export function visibleSettingsPages(pages: WidgetSettingsPages | undefined, legacyActionCount = 0): WidgetSettingsPageId[] {
  return WIDGET_SETTINGS_PAGES.filter(
    (id) => hasRenderableContent(pages?.[id]) || (id === 'geral' && legacyActionCount > 0),
  );
}
