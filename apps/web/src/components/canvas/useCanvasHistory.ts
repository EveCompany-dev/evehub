'use client';

import type { CanvasState } from '@eve/core/canvas';
import { useCallback, useRef, useState } from 'react';

const LIMIT = 50;

export interface CanvasHistory {
  /** Records the state *before* a change, so undo can put it back. */
  push: (previous: CanvasState) => void;
  undo: (current: CanvasState) => CanvasState | null;
  redo: (current: CanvasState) => CanvasState | null;
  canUndo: boolean;
  canRedo: boolean;
  clear: () => void;
}

/**
 * Local undo for board edits.
 *
 * Deliberately *not* the `EditLog`/undo machinery in @eve/core: that one
 * exists to reverse writes sent to an outside service (a Notion page the
 * connector changed) and is shared, durable and audited. Moving a node is
 * neither — it's this user's own layout, saved to their own dashboardConfig,
 * and the expectation for a board is that Ctrl+Z is instant and goes back
 * many steps.
 *
 * Snapshots are whole `CanvasState` values. A board is a few hundred numbers
 * and strings; diffing it would cost more to maintain than it saves.
 */
export function useCanvasHistory(): CanvasHistory {
  const past = useRef<CanvasState[]>([]);
  const future = useRef<CanvasState[]>([]);
  // Mirrored into state purely so menus can disable the entries.
  const [depth, setDepth] = useState({ past: 0, future: 0 });

  const sync = useCallback(() => {
    setDepth({ past: past.current.length, future: future.current.length });
  }, []);

  const push = useCallback(
    (previous: CanvasState) => {
      past.current = [...past.current.slice(-(LIMIT - 1)), previous];
      // A new edit invalidates anything that was undone: the timeline forked.
      future.current = [];
      sync();
    },
    [sync],
  );

  const undo = useCallback(
    (current: CanvasState) => {
      const previous = past.current.pop();
      if (!previous) return null;
      future.current = [...future.current.slice(-(LIMIT - 1)), current];
      sync();
      return previous;
    },
    [sync],
  );

  const redo = useCallback(
    (current: CanvasState) => {
      const next = future.current.pop();
      if (!next) return null;
      past.current = [...past.current.slice(-(LIMIT - 1)), current];
      sync();
      return next;
    },
    [sync],
  );

  const clear = useCallback(() => {
    past.current = [];
    future.current = [];
    sync();
  }, [sync]);

  return { push, undo, redo, canUndo: depth.past > 0, canRedo: depth.future > 0, clear };
}
