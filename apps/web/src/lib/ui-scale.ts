/**
 * The site-wide `zoom` scale (see layout.tsx / the /settings Interface tab) is
 * applied on <html>, and that scale multiplies the CSS pixels descendants are
 * painted at. `MouseEvent.clientX/clientY` are reported in real, unzoomed
 * viewport pixels, so anything that positions a `position: fixed` element (or
 * does board-space math) straight off those values overshoots by exactly the
 * zoom factor, growing with distance from the top-left corner. Dividing by
 * the current zoom cancels that back out — see CustomCursor.tsx and
 * JobsBoard.tsx's `zoomAwareModifier` for the same fix applied elsewhere.
 */
export function currentUiZoom(): number {
  if (typeof document === 'undefined') return 1;
  const raw = getComputedStyle(document.documentElement).zoom;
  if (!raw) return 1;
  const value = raw.endsWith('%') ? parseFloat(raw) / 100 : parseFloat(raw);
  return Number.isFinite(value) && value > 0 ? value : 1;
}
