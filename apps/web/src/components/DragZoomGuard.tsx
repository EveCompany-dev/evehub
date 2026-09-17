'use client';

import { useEffect, type JSX } from 'react';
import { applyUiScale } from './SettingsSections';
import { currentUiZoom } from '../lib/ui-scale';

/**
 * Native OS file drag-and-drop (dragging an image from Explorer/Finder into
 * an <ImageDropZone>) does its own hit-testing at the browser/compositor
 * level, separate from the click/hover hit-testing our own code compensates
 * for elsewhere (see ui-scale.ts's currentUiZoom doc). Under the site-wide
 * `zoom` scale (default 150%, /settings → Interface) that hit-testing can
 * miss the intended drop target entirely, so the `drop` handler never fires
 * and the file silently never uploads — no error, nothing happens, on every
 * drop zone in the app. Suspending the zoom for the duration of an
 * external-file drag (dragenter → drop/dragleave) sidesteps it without
 * touching the scale feature itself. `dataTransfer.types.includes('Files')`
 * keeps this from ever engaging for the app's *other* drag interactions
 * (Jobs board, canvas) — those use dnd-kit's pointer events, not native HTML5
 * drag-and-drop, so they never fire these listeners at all.
 */
export function DragZoomGuard(): JSX.Element | null {
  useEffect(() => {
    let depth = 0;
    let savedScale: number | null = null;

    const isFileDrag = (event: DragEvent) => Boolean(event.dataTransfer?.types.includes('Files'));

    const restore = () => {
      depth = 0;
      if (savedScale !== null) {
        applyUiScale(savedScale);
        savedScale = null;
      }
    };

    const onDragEnter = (event: DragEvent) => {
      if (!isFileDrag(event)) return;
      depth += 1;
      if (depth === 1) {
        savedScale = currentUiZoom();
        applyUiScale(1);
      }
    };

    const onDragLeave = (event: DragEvent) => {
      if (!isFileDrag(event)) return;
      depth = Math.max(0, depth - 1);
      if (depth === 0) restore();
    };

    const onDrop = (event: DragEvent) => {
      if (!isFileDrag(event)) return;
      restore();
    };

    window.addEventListener('dragenter', onDragEnter);
    window.addEventListener('dragleave', onDragLeave);
    window.addEventListener('drop', onDrop);
    window.addEventListener('dragend', restore);
    return () => {
      window.removeEventListener('dragenter', onDragEnter);
      window.removeEventListener('dragleave', onDragLeave);
      window.removeEventListener('drop', onDrop);
      window.removeEventListener('dragend', restore);
      restore();
    };
  }, []);

  return null;
}
