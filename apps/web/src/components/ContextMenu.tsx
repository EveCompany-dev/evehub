'use client';

import { useEffect, useRef, useState, type JSX, type MouseEvent as ReactMouseEvent } from 'react';
import { currentUiZoom } from '../lib/ui-scale';
import { Check, ChevronRight } from '@eve/ui';

export interface ContextMenuItem {
  label: string;
  /** Omit when the item only opens a submenu, or when it's a separator. */
  onSelect?: () => void;
  danger?: boolean;
  disabled?: boolean;
  /** Right-aligned hint, for a keyboard shortcut or a value ("Ctrl+D", "150%"). */
  hint?: string;
  /** Renders a check mark, for items that toggle something. */
  checked?: boolean;
  /** A horizontal rule instead of an item. Everything else on it is ignored. */
  separator?: boolean;
  /** Nested items, opened as a flyout on hover — e.g. the list of modules to add. */
  items?: ContextMenuItem[];
}

interface ContextMenuState {
  x: number;
  y: number;
  items: ContextMenuItem[];
}

export interface ContextMenuControls {
  open: (event: ReactMouseEvent, items: ContextMenuItem[]) => void;
  close: () => void;
  render: () => JSX.Element | null;
}

const ITEM_HEIGHT = 34;
const MENU_WIDTH = 220;

/** Flips a menu back on-screen near the right/bottom edges. */
function fit(x: number, y: number, count: number): { left: number; top: number } {
  return {
    left: Math.max(8, Math.min(x, window.innerWidth - MENU_WIDTH - 8)),
    top: Math.max(8, Math.min(y, window.innerHeight - count * ITEM_HEIGHT - 16)),
  };
}

/**
 * Right-click menu, positioned at the cursor — the Office-style alternative
 * to a fixed toolbar for row/column actions, the dashboard's way to add
 * modules, and the ⋮ menus (Tabelas, Equipe). `open` is wired to an
 * element's `onContextMenu` or `onClick`; `render()` renders the floating
 * menu (or nothing) and should be called once near the root of whatever uses it.
 *
 * One level of submenu is supported, which is enough for "add module ▸ list
 * of connectors" without turning this into a general menu framework.
 */
export function useContextMenu(): ContextMenuControls {
  const [menu, setMenu] = useState<ContextMenuState | null>(null);
  const [openSub, setOpenSub] = useState<number | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  const open = (event: ReactMouseEvent, items: ContextMenuItem[]) => {
    event.preventDefault();
    event.stopPropagation();
    const zoom = currentUiZoom();
    setMenu({ x: event.clientX / zoom, y: event.clientY / zoom, items });
    setOpenSub(null);
  };

  const close = () => {
    setMenu(null);
    setOpenSub(null);
  };

  useEffect(() => {
    if (!menu) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!ref.current?.contains(event.target as Node)) close();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    // Capture-phase, so scrolling any container (a table, the page) closes
    // it instead of leaving it floating over content that moved away.
    document.addEventListener('scroll', close, true);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('scroll', close, true);
    };
  }, [menu]);

  const renderItem = (item: ContextMenuItem, index: number, parentLeft: number, parentTop: number): JSX.Element => {
    if (item.separator) return <div key={`sep-${index}`} className="eve-menu__separator" role="separator" />;

    const hasSub = Boolean(item.items && item.items.length > 0);
    const className = [
      'eve-menu__item',
      item.danger ? 'eve-menu__item--danger' : null,
      hasSub ? 'eve-menu__item--parent' : null,
      openSub === index ? 'is-open' : null,
    ]
      .filter(Boolean)
      .join(' ');

    return (
      <div key={`${item.label}-${index}`} className="eve-menu__row" onMouseEnter={() => setOpenSub(hasSub ? index : null)}>
        <button
          type="button"
          role="menuitem"
          className={className}
          disabled={item.disabled}
          onClick={() => {
            // A tap opens the flyout too: touch screens never send the hover.
            if (hasSub) {
              setOpenSub(openSub === index ? null : index);
              return;
            }
            if (!item.onSelect) return;
            item.onSelect();
            close();
          }}
        >
          <span className="eve-menu__label">
            {item.checked ? <Check size={14} aria-hidden="true" className="eve-menu__check" /> : null}
            {item.label}
          </span>
          {item.hint && <span className="eve-menu__hint">{item.hint}</span>}
          {hasSub && <span className="eve-menu__chevron" aria-hidden="true"><ChevronRight size={14} aria-hidden="true" /></span>}
        </button>

        {hasSub && openSub === index && (
          <div
            className="eve-menu eve-menu--sub"
            role="menu"
            style={{
              position: 'fixed',
              // The base .eve-menu class (tokens.css) sets `right: 0` for its
              // usual anchored-dropdown case; left unset here, that fights
              // the `left` below over the box's width and pushed the flyout
              // away from the parent item instead of hugging it.
              right: 'auto',
              // MENU_WIDTH is only ever a floor (the menu's CSS is `min-width`, not a
              // fixed width) — the actual row text ("Adicionar módulo" etc.) usually
              // renders narrower, so anchoring off the constant left a gap between the
              // two menus instead of the intended 4px overlap. Measuring the real
              // rendered box (available once the parent menu has painted at least once,
              // which it has by the time a submenu can open) closes that gap.
              left: Math.min(
                parentLeft + (ref.current?.offsetWidth ?? MENU_WIDTH) - 4,
                window.innerWidth - MENU_WIDTH - 8,
              ),
              top: Math.min(parentTop + index * ITEM_HEIGHT, window.innerHeight - item.items!.length * ITEM_HEIGHT - 16),
            }}
          >
            {item.items!.map((sub, subIndex) => (
              <button
                key={`${sub.label}-${subIndex}`}
                type="button"
                role="menuitem"
                className={sub.danger ? 'eve-menu__item eve-menu__item--danger' : 'eve-menu__item'}
                disabled={sub.disabled}
                onClick={() => {
                  sub.onSelect?.();
                  close();
                }}
              >
                <span className="eve-menu__label">
                  {sub.checked ? <Check size={14} aria-hidden="true" className="eve-menu__check" /> : null}
                  {sub.label}
                </span>
                {sub.hint && <span className="eve-menu__hint">{sub.hint}</span>}
              </button>
            ))}
          </div>
        )}
      </div>
    );
  };

  const render = (): JSX.Element | null => {
    if (!menu) return null;

    const { left, top } = fit(menu.x, menu.y, menu.items.length);

    return (
      <div ref={ref} className="eve-menu eve-contextmenu" role="menu" style={{ position: 'fixed', top, left, right: 'auto' }}>
        {menu.items.map((item, index) => renderItem(item, index, left, top))}
      </div>
    );
  };

  return { open, close, render };
}
