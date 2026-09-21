'use client';

import { useEffect, useRef, type JSX, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { currentUiZoom } from '../lib/ui-scale';

export interface PopoverProps {
  /** Screen rect of the element the popover hangs from (getBoundingClientRect). */
  anchor: DOMRect;
  onClose: () => void;
  children: ReactNode;
  className?: string;
  width?: number;
}

const MARGIN = 8;

/**
 * Floating panel pinned under an element, rendered on <body> so scrolling
 * tables and modals can't clip it. Positions are divided by the site-wide
 * zoom (see lib/ui-scale) like the context menu, and it flips above the
 * anchor when there's no room below. Closes on outside click and Escape.
 */
export function Popover({ anchor, onClose, children, className, width = 260 }: PopoverProps): JSX.Element {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onPointerDown = (event: MouseEvent) => {
      if (!ref.current?.contains(event.target as Node)) onClose();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
      }
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown, true);
    };
  }, [onClose]);

  const zoom = currentUiZoom();
  const viewportWidth = window.innerWidth / zoom;
  const viewportHeight = window.innerHeight / zoom;
  const left = Math.max(MARGIN, Math.min(anchor.left / zoom, viewportWidth - width - MARGIN));
  const below = anchor.bottom / zoom + 4;
  const room = viewportHeight - below - MARGIN;
  const flip = room < 220 && anchor.top / zoom > room;

  const style = flip
    ? { left, width, bottom: viewportHeight - anchor.top / zoom + 4, maxHeight: Math.max(160, anchor.top / zoom - MARGIN * 2) }
    : { left, width, top: below, maxHeight: Math.max(160, room) };

  return createPortal(
    <div ref={ref} className={['eve-popover', className].filter(Boolean).join(' ')} style={{ position: 'fixed', ...style }} role="dialog">
      {children}
    </div>,
    document.body,
  );
}
