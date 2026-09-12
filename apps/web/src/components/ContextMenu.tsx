'use client';

import { useEffect, useRef, useState, type JSX, type MouseEvent as ReactMouseEvent } from 'react';

export interface ContextMenuItem {
  label: string;
  onSelect: () => void;
  danger?: boolean;
}

interface ContextMenuState {
  x: number;
  y: number;
  items: ContextMenuItem[];
}

export interface ContextMenuControls {
  open: (event: ReactMouseEvent, items: ContextMenuItem[]) => void;
  render: () => JSX.Element | null;
}

/**
 * Right-click menu, positioned at the cursor — the Office-style alternative
 * to a fixed toolbar for row/column actions. `open` is meant to be wired to
 * an element's `onContextMenu`; `render()` renders the floating menu (or
 * nothing) and should be called once near the root of whatever uses it.
 */
export function useContextMenu(): ContextMenuControls {
  const [menu, setMenu] = useState<ContextMenuState | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  const open = (event: ReactMouseEvent, items: ContextMenuItem[]) => {
    event.preventDefault();
    event.stopPropagation();
    setMenu({ x: event.clientX, y: event.clientY, items });
  };

  const close = () => setMenu(null);

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
    document.addEventListener('scroll', close, true);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('scroll', close, true);
    };
  }, [menu]);

  const render = (): JSX.Element | null => {
    if (!menu) return null;

    // Keep the menu on-screen near the right/bottom edges.
    const width = 200;
    const left = Math.min(menu.x, window.innerWidth - width - 8);
    const top = Math.min(menu.y, window.innerHeight - menu.items.length * 34 - 16);

    return (
      <div
        ref={ref}
        className="eve-menu eve-contextmenu"
        role="menu"
        style={{ position: 'fixed', top, left, right: 'auto' }}
      >
        {menu.items.map((item) => (
          <button
            key={item.label}
            type="button"
            role="menuitem"
            className={item.danger ? 'eve-menu__item eve-menu__item--danger' : 'eve-menu__item'}
            onClick={() => {
              item.onSelect();
              close();
            }}
          >
            {item.label}
          </button>
        ))}
      </div>
    );
  };

  return { open, render };
}
