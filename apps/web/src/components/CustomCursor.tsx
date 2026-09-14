'use client';

import { EveArch } from '@eve/ui';
import { useEffect, useRef, type JSX } from 'react';

/**
 * Site-wide custom cursor: a small orange dot with a soft glow by default,
 * morphing into the Eve mark when hovering anything the browser would show
 * a pointer cursor for. Desktop-only — `globals.css` hides the native
 * cursor and this component's own render only under `(pointer: fine)`;
 * touch devices keep whatever they already had, there is nothing to
 * replace there.
 *
 * Position and hover state are written straight to the DOM via refs
 * instead of React state, since pointermove fires far too often for
 * re-renders.
 */
/**
 * The site-wide `zoom` scale (see layout.tsx / the /settings Interface tab) is
 * applied on <html>, and that scale multiplies CSS pixel values used by
 * descendants — including a `position: fixed` element's own `transform`.
 * `MouseEvent.clientX/clientY` are reported in real, unzoomed viewport
 * pixels, so writing them straight into `transform` overshoots by exactly
 * the zoom factor, growing with distance from the top-left corner. Dividing
 * by the current zoom cancels that multiplication back out.
 */
function currentZoom(): number {
  const raw = getComputedStyle(document.documentElement).zoom;
  if (!raw) return 1;
  const value = raw.endsWith('%') ? parseFloat(raw) / 100 : parseFloat(raw);
  return Number.isFinite(value) && value > 0 ? value : 1;
}

export function CustomCursor(): JSX.Element | null {
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!window.matchMedia('(pointer: fine)').matches) return;

    const root = rootRef.current;
    if (!root) return;

    const onMove = (event: PointerEvent) => {
      root.style.opacity = '1';
      const zoom = currentZoom();
      root.style.transform = `translate3d(${event.clientX / zoom}px, ${event.clientY / zoom}px, 0)`;
      const target = event.target;
      const hover = target instanceof Element && window.getComputedStyle(target).cursor === 'pointer';
      root.classList.toggle('is-hover', hover);
    };

    // Mouse leaving the browser window entirely — otherwise a stray dot
    // sits frozen at the last known position over other apps/the taskbar.
    const onLeave = (event: MouseEvent) => {
      if (!event.relatedTarget) root.style.opacity = '0';
    };

    document.addEventListener('pointermove', onMove);
    document.addEventListener('mouseout', onLeave);
    return () => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('mouseout', onLeave);
    };
  }, []);

  return (
    <div className="eve-cursor" ref={rootRef} aria-hidden="true">
      <span className="eve-cursor__dot" />
      <span className="eve-cursor__icon">
        <EveArch size={22} />
      </span>
    </div>
  );
}
