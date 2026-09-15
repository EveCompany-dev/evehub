'use client';

import { EveArch } from '@eve/ui';
import { useEffect, useRef, type JSX } from 'react';

/**
 * Site-wide cursor companion: a small orange dot with a soft glow that
 * trails the native pointer, morphing into the Eve mark over anything the
 * browser would show a pointer cursor for. The real system cursor stays
 * visible and authoritative — this only decorates it, a step behind.
 * Desktop-only: the render is suppressed under `(pointer: coarse)` in
 * `globals.css`, since there is no pointer to trail on touch.
 *
 * Position and hover state are written straight to the DOM via refs
 * instead of React state, since pointermove fires far too often for
 * re-renders.
 */

/**
 * Fraction of the remaining distance the dot closes each animation frame.
 * Lower trails further behind the pointer; 1 would pin it exactly on top.
 * ~0.15 reads as a soft, deliberate lag at 60fps without ever feeling
 * detached from the pointer.
 */
const FOLLOW_EASE = 0.15;

/** Below this much remaining travel (px) the dot has effectively arrived. */
const SETTLE_EPSILON = 0.1;

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
    // The trailing motion is decoration; honour a reduced-motion preference
    // by pinning the dot straight onto the pointer instead.
    const ease = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 1 : FOLLOW_EASE;

    const root = rootRef.current;
    if (!root) return;

    const target = { x: 0, y: 0 };
    const dot = { x: 0, y: 0 };
    // The first sample snaps, so the dot doesn't fly in from the corner.
    let placed = false;
    let frame = 0;

    const draw = () => {
      frame = 0;
      dot.x += (target.x - dot.x) * ease;
      dot.y += (target.y - dot.y) * ease;
      const zoom = currentZoom();
      root.style.transform = `translate3d(${dot.x / zoom}px, ${dot.y / zoom}px, 0)`;
      // Keep the loop alive only while there is distance left to close, so an
      // idle pointer costs nothing.
      if (
        Math.abs(target.x - dot.x) > SETTLE_EPSILON ||
        Math.abs(target.y - dot.y) > SETTLE_EPSILON
      ) {
        frame = requestAnimationFrame(draw);
      }
    };

    const onMove = (event: PointerEvent) => {
      root.style.opacity = '1';
      target.x = event.clientX;
      target.y = event.clientY;
      if (!placed) {
        dot.x = target.x;
        dot.y = target.y;
        placed = true;
      }
      const element = event.target;
      const hover =
        element instanceof Element && window.getComputedStyle(element).cursor === 'pointer';
      root.classList.toggle('is-hover', hover);
      if (!frame) frame = requestAnimationFrame(draw);
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
      if (frame) cancelAnimationFrame(frame);
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
