'use client';

import {
  MAX_ZOOM,
  MIN_ZOOM,
  NODE_MIN_H,
  NODE_MIN_W,
  addNode,
  boundsOf,
  bringToFront,
  connectNodes,
  createImageNode,
  createTextNode,
  disconnectEdge,
  duplicateNode,
  moveNode,
  removeNode,
  renameScreen,
  resizeNode,
  sendToBack,
  setEdgeLabel,
  setNodeLocked,
  snapValue,
  toBoardPoint,
  updateNode,
  viewportForBounds,
  type CanvasNode,
  type CanvasState,
  type WidgetNode,
} from '@eve/core/canvas';
import type { ViewConfig } from '@eve/core/dashboard';
import { strings } from '@eve/ui';
import {
  createElement,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type JSX,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import { getWidget } from '../../widgets/registry';
import { WidgetErrorBoundary } from '../../widgets/WidgetErrorBoundary';
import { useContextMenu, type ContextMenuItem } from '../ContextMenu';
import type { InstanceSummary } from '../DashboardGrid';
import type { AvailableConnector } from '../DashboardShell';
import { CanvasEdges, type PendingLink } from './CanvasEdges';
import { CanvasNodeView } from './CanvasNodeView';
import { useCanvasHistory } from './useCanvasHistory';

/** Board pixels between grid dots at 100% zoom. */
const GRID_STEP = 24;
const NUDGE = 8;

export interface CanvasFocusRequest {
  nodeIds: string[];
  /** Bumped by the caller so the same target can be re-focused. */
  token: number;
}

export interface CanvasBoardProps {
  canvas: CanvasState;
  instances: InstanceSummary[];
  available: AvailableConnector[];
  /**
   * Functional update, so the board never has to hold the current state to
   * describe a change — the shell owns it. See `commit` below.
   */
  onUpdate: (change: (current: CanvasState) => CanvasState) => void;
  /** Resolves the connector to an instance (possibly via a credentials form) and drops a node at `at`. */
  onAddModule: (connector: AvailableConnector, at: { x: number; y: number }) => void;
  /** Ctrl+K asking the board to frame a tela or a node. Empty `nodeIds` = fit everything. */
  focusRequest: CanvasFocusRequest | null;
}

type Gesture =
  | { kind: 'pan'; pointer: { x: number; y: number }; origin: { x: number; y: number } }
  | { kind: 'move'; nodeIds: string[]; pointer: { x: number; y: number } }
  | { kind: 'resize'; nodeId: string; pointer: { x: number; y: number }; origin: { w: number; h: number } }
  | { kind: 'connect'; from: string; at: { x: number; y: number } }
  | { kind: 'marquee'; start: { x: number; y: number }; current: { x: number; y: number } };

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

function rectOf(a: { x: number; y: number }, b: { x: number; y: number }): Rect {
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(b.x - a.x), h: Math.abs(b.y - a.y) };
}

function intersects(node: CanvasNode, rect: Rect): boolean {
  return node.x < rect.x + rect.w && node.x + node.w > rect.x && node.y < rect.y + rect.h && node.y + node.h > rect.y;
}

/** True when the keystroke belongs to whatever the user is typing in, not to the board. */
function isTypingTarget(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null;
  if (!element) return false;
  const tag = element.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || element.isContentEditable;
}

/**
 * The freeform board: modules, text and images placed anywhere, linked into
 * telas, over a pan/zoom viewport.
 *
 * Geometry is stored in board pixels and mapped to the screen by one CSS
 * transform on a single layer, so a node's saved position never depends on
 * the zoom it was placed at. Live gestures (drag, resize, link) are kept in
 * component state and applied as visual offsets — the stored state is only
 * written when the gesture ends, which is also the only moment that reaches
 * the database.
 */
export function CanvasBoard({
  canvas,
  instances,
  available,
  onUpdate,
  onAddModule,
  focusRequest,
}: CanvasBoardProps): JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null);
  const gesture = useRef<Gesture | null>(null);
  const history = useCanvasHistory();
  const menu = useContextMenu();

  const [selection, setSelection] = useState<string[]>([]);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [editingNodeId, setEditingNodeId] = useState<string | null>(null);
  const [movePreview, setMovePreview] = useState<{ ids: string[]; dx: number; dy: number } | null>(null);
  const [resizePreview, setResizePreview] = useState<{ id: string; w: number; h: number } | null>(null);
  const [pendingLink, setPendingLink] = useState<PendingLink | null>(null);
  const [marquee, setMarquee] = useState<Rect | null>(null);
  const [spaceHeld, setSpaceHeld] = useState(false);
  const [uploading, setUploading] = useState(false);

  const { viewport, nodes, edges, screens } = canvas;
  const boardLocked = canvas.locked;

  const instancesById = useMemo(() => new Map(instances.map((instance) => [instance.id, instance])), [instances]);
  const screensById = useMemo(() => new Map(screens.map((screen) => [screen.id, screen])), [screens]);
  const nodesById = useMemo(() => new Map(nodes.map((node) => [node.id, node])), [nodes]);

  /**
   * Every board edit goes through here: it snapshots the previous state for
   * undo and hands the change up for persistence, so no caller has to
   * remember either.
   *
   * It takes a function rather than a value so its own identity never depends
   * on the current board — which is what lets the per-node widget elements
   * below survive a drag instead of being rebuilt on every pointer move.
   */
  const commit = useCallback(
    (change: (current: CanvasState) => CanvasState) => {
      onUpdate((current) => {
        const next = change(current);
        if (next !== current) history.push(current);
        return next;
      });
    },
    [history, onUpdate],
  );

  /** Viewport moves are not undoable — panning is navigation, not an edit. */
  const setViewport = useCallback(
    (next: CanvasState['viewport']) => onUpdate((current) => ({ ...current, viewport: next })),
    [onUpdate],
  );

  const screenPointToBoard = useCallback(
    (clientX: number, clientY: number) => {
      const rect = containerRef.current?.getBoundingClientRect();
      return toBoardPoint({ x: clientX - (rect?.left ?? 0), y: clientY - (rect?.top ?? 0) }, viewport);
    },
    [viewport],
  );

  // ---------------------------------------------------------------------
  // Stable per-node widget content
  // ---------------------------------------------------------------------

  /**
   * Identity of everything the widget elements actually depend on — which
   * deliberately excludes geometry. Dragging a node changes x/y a hundred
   * times a second and must not rebuild (and so re-render) a module that is
   * mid-fetch; renaming one, or changing which fields it shows, must.
   */
  const contentSignature = nodes
    .filter((node): node is WidgetNode => node.kind === 'widget')
    .map((node) => `${node.id}|${node.instanceId}|${node.title ?? ''}|${JSON.stringify(node.viewConfig)}`)
    .join(';');

  const widgetContent = useMemo(() => {
    const byNode = new Map<string, ReactNode>();

    for (const node of nodes) {
      if (node.kind !== 'widget') continue;

      const remove = () => commit((current) => removeNode(current, node.id));
      const instance = instancesById.get(node.instanceId);

      if (!instance) {
        byNode.set(
          node.id,
          <div className="eve-canvas__missing">
            <p>{strings.canvas.missingInstance}</p>
            <button type="button" className="eve-btn eve-no-drag" onClick={remove}>
              {strings.dashboard.removeWidget}
            </button>
          </div>,
        );
        continue;
      }

      const title = node.title ?? instance.label;

      byNode.set(
        node.id,
        <WidgetErrorBoundary title={title} onRemove={remove}>
          {/* `createElement` rather than JSX: the component comes out of the
              registry at runtime, and binding it to a capitalized local here
              reads as declaring a component mid-render. */}
          {createElement(getWidget(instance.connectorId), {
            instanceId: node.instanceId,
            title,
            onRemove: remove,
            viewConfig: node.viewConfig,
            onViewConfigChange: (next: ViewConfig) =>
              commit((current) => updateNode(current, node.id, { viewConfig: next })),
          })}
        </WidgetErrorBoundary>,
      );
    }

    return byNode;
    // `nodes` is intentionally not a dependency: `contentSignature` is the
    // part of it these elements are built from, and depending on the array
    // itself would defeat the whole point.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [commit, contentSignature, instancesById]);

  // ---------------------------------------------------------------------
  // Gestures
  // ---------------------------------------------------------------------

  const beginGesture = (event: ReactPointerEvent, next: Gesture) => {
    gesture.current = next;
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };

  const handleBackgroundPointerDown = (event: ReactPointerEvent) => {
    if (event.button === 2) return;

    const panning = event.button === 1 || spaceHeld || boardLocked;
    if (panning) {
      beginGesture(event, {
        kind: 'pan',
        pointer: { x: event.clientX, y: event.clientY },
        origin: { x: viewport.x, y: viewport.y },
      });
      return;
    }

    const at = screenPointToBoard(event.clientX, event.clientY);
    setSelectedEdgeId(null);
    if (!event.shiftKey) setSelection([]);
    setEditingNodeId(null);
    beginGesture(event, { kind: 'marquee', start: at, current: at });
    setMarquee({ ...at, w: 0, h: 0 });
  };

  const handleNodePointerDown = useCallback(
    (event: ReactPointerEvent, nodeId: string, part: 'body' | 'handle') => {
      if (event.button === 2) return;
      const node = nodesById.get(nodeId);
      if (!node) return;

      const target = event.target as HTMLElement;
      if (target.closest('.eve-no-drag')) return;

      // Selection happens on any press, even one that won't drag — clicking a
      // module should select it so the keyboard and the menus have a subject.
      setSelectedEdgeId(null);
      setSelection((current) => {
        if (event.shiftKey) {
          return current.includes(nodeId) ? current.filter((id) => id !== nodeId) : [...current, nodeId];
        }
        return current.includes(nodeId) ? current : [nodeId];
      });

      if (boardLocked || node.locked) return;
      if (spaceHeld) return;

      // A widget node only drags by its header, exactly like the grid: a
      // press anywhere else belongs to the module's own UI.
      const draggable = part === 'handle' || Boolean(target.closest('.eve-widget__header'));
      if (!draggable) return;

      event.stopPropagation();
      const moving = selection.includes(nodeId) && !event.shiftKey ? selection : [nodeId];
      const movable = moving.filter((id) => !nodesById.get(id)?.locked);

      beginGesture(event, { kind: 'move', nodeIds: movable, pointer: { x: event.clientX, y: event.clientY } });
      setMovePreview({ ids: movable, dx: 0, dy: 0 });
    },
    [boardLocked, nodesById, selection, spaceHeld],
  );

  const handleResizePointerDown = useCallback(
    (event: ReactPointerEvent, nodeId: string) => {
      const node = nodesById.get(nodeId);
      if (!node || boardLocked || node.locked) return;

      event.stopPropagation();
      beginGesture(event, {
        kind: 'resize',
        nodeId,
        pointer: { x: event.clientX, y: event.clientY },
        origin: { w: node.w, h: node.h },
      });
      setResizePreview({ id: nodeId, w: node.w, h: node.h });
    },
    [boardLocked, nodesById],
  );

  const handleConnectPointerDown = useCallback(
    (event: ReactPointerEvent, nodeId: string) => {
      const node = nodesById.get(nodeId);
      if (!node || boardLocked) return;

      event.stopPropagation();
      const from = { x: node.x + node.w, y: node.y + node.h / 2 };
      beginGesture(event, { kind: 'connect', from: nodeId, at: from });
      setPendingLink({ from, to: from });
    },
    [boardLocked, nodesById],
  );

  const handlePointerMove = (event: ReactPointerEvent) => {
    const current = gesture.current;
    if (!current) return;

    if (current.kind === 'pan') {
      setViewport({
        ...viewport,
        x: current.origin.x + (event.clientX - current.pointer.x),
        y: current.origin.y + (event.clientY - current.pointer.y),
      });
      return;
    }

    if (current.kind === 'move') {
      const dx = (event.clientX - current.pointer.x) / viewport.zoom;
      const dy = (event.clientY - current.pointer.y) / viewport.zoom;
      setMovePreview({ ids: current.nodeIds, dx: snapValue(dx, canvas.snap), dy: snapValue(dy, canvas.snap) });
      return;
    }

    if (current.kind === 'resize') {
      const dx = (event.clientX - current.pointer.x) / viewport.zoom;
      const dy = (event.clientY - current.pointer.y) / viewport.zoom;
      setResizePreview({
        id: current.nodeId,
        w: Math.max(NODE_MIN_W, snapValue(current.origin.w + dx, canvas.snap)),
        h: Math.max(NODE_MIN_H, snapValue(current.origin.h + dy, canvas.snap)),
      });
      return;
    }

    if (current.kind === 'connect') {
      setPendingLink({ from: current.at, to: screenPointToBoard(event.clientX, event.clientY) });
      return;
    }

    if (current.kind === 'marquee') {
      const at = screenPointToBoard(event.clientX, event.clientY);
      gesture.current = { ...current, current: at };
      const rect = rectOf(current.start, at);
      setMarquee(rect);
      setSelection(nodes.filter((node) => intersects(node, rect)).map((node) => node.id));
    }
  };

  const handlePointerUp = (event: ReactPointerEvent) => {
    const current = gesture.current;
    gesture.current = null;

    if (!current) return;

    if (current.kind === 'move' && movePreview && (movePreview.dx !== 0 || movePreview.dy !== 0)) {
      const { dx, dy } = movePreview;
      commit((state) =>
        current.nodeIds.reduce((board, id) => {
          const node = board.nodes.find((candidate) => candidate.id === id);
          return node ? moveNode(board, id, { x: node.x + dx, y: node.y + dy }) : board;
        }, state),
      );
    }

    if (current.kind === 'resize' && resizePreview) {
      const { w, h } = resizePreview;
      commit((state) => resizeNode(state, current.nodeId, { w, h }));
    }

    if (current.kind === 'connect') {
      // Whatever node is under the pointer when the link is dropped becomes
      // the other end — dropping on empty board is a cancel, not an error.
      const element = document.elementFromPoint(event.clientX, event.clientY) as HTMLElement | null;
      const targetId = element?.closest('[data-node-id]')?.getAttribute('data-node-id');
      if (targetId && targetId !== current.from) commit((state) => connectNodes(state, current.from, targetId));
    }

    setMovePreview(null);
    setResizePreview(null);
    setPendingLink(null);
    setMarquee(null);
  };

  const handleWheel = (event: React.WheelEvent) => {
    // Ctrl/⌘+wheel (and trackpad pinch, which arrives the same way) zooms
    // around the cursor; a plain wheel over a module belongs to that module's
    // own scrollbar, and over the board it pans.
    if (event.ctrlKey || event.metaKey) {
      event.preventDefault();
      const rect = containerRef.current?.getBoundingClientRect();
      const cursor = { x: event.clientX - (rect?.left ?? 0), y: event.clientY - (rect?.top ?? 0) };
      const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, viewport.zoom * (1 - event.deltaY * 0.0015)));

      setViewport({
        zoom,
        x: cursor.x - ((cursor.x - viewport.x) / viewport.zoom) * zoom,
        y: cursor.y - ((cursor.y - viewport.y) / viewport.zoom) * zoom,
      });
      return;
    }

    if ((event.target as HTMLElement).closest('.eve-canvas__node')) return;

    event.preventDefault();
    setViewport({ ...viewport, x: viewport.x - event.deltaX, y: viewport.y - event.deltaY });
  };

  // ---------------------------------------------------------------------
  // Framing
  // ---------------------------------------------------------------------

  const fitTo = useCallback(
    (nodeIds: string[]) => {
      const subject = nodeIds.length > 0 ? nodes.filter((node) => nodeIds.includes(node.id)) : nodes;
      const bounds = boundsOf(subject);
      const rect = containerRef.current?.getBoundingClientRect();
      if (!bounds || !rect) return;

      setViewport(viewportForBounds(bounds, { width: rect.width, height: rect.height }));
      if (nodeIds.length > 0) setSelection(nodeIds);
    },
    [nodes, setViewport],
  );

  const focusToken = useRef<number | null>(null);
  useEffect(() => {
    if (!focusRequest || focusRequest.token === focusToken.current) return;
    focusToken.current = focusRequest.token;
    fitTo(focusRequest.nodeIds);
  }, [fitTo, focusRequest]);

  // ---------------------------------------------------------------------
  // Board edits
  // ---------------------------------------------------------------------

  const addText = useCallback(
    (at: { x: number; y: number }) => {
      const node = createTextNode(at);
      commit((state) => addNode(state, node));
      setEditingNodeId(node.id);
      setSelection([node.id]);
    },
    [commit],
  );

  const uploadImage = useCallback(
    async (file: File, at: { x: number; y: number }) => {
      setUploading(true);
      try {
        const form = new FormData();
        form.append('file', file);
        const response = await fetch('/api/uploads/canvas-image', { method: 'POST', body: form });
        const body = (await response.json().catch(() => ({}))) as { url?: string };
        const url = body.url;
        if (!response.ok || !url) return;

        commit((state) => addNode(state, createImageNode(url, at)));
      } finally {
        setUploading(false);
      }
    },
    [commit],
  );

  const centreOfView = useCallback(() => {
    const rect = containerRef.current?.getBoundingClientRect();
    return toBoardPoint({ x: (rect?.width ?? 800) / 2, y: (rect?.height ?? 600) / 2 }, viewport);
  }, [viewport]);

  const removeSelection = useCallback(() => {
    commit((state) => {
      let next = selection.reduce((board, id) => removeNode(board, id), state);
      if (selectedEdgeId) next = disconnectEdge(next, selectedEdgeId);
      return next;
    });
    setSelection([]);
    setSelectedEdgeId(null);
  }, [commit, selectedEdgeId, selection]);

  const duplicateSelection = useCallback(() => {
    commit((state) => selection.reduce((board, id) => duplicateNode(board, id), state));
  }, [commit, selection]);

  // ---------------------------------------------------------------------
  // Keyboard
  // ---------------------------------------------------------------------

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.code === 'Space' && !isTypingTarget(event.target)) setSpaceHeld(true);
      if (isTypingTarget(event.target)) return;

      const meta = event.ctrlKey || event.metaKey;

      if (meta && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        const next = event.shiftKey ? history.redo(canvas) : history.undo(canvas);
        if (next) onUpdate(() => next);
        return;
      }
      if (meta && event.key.toLowerCase() === 'd' && selection.length > 0) {
        event.preventDefault();
        duplicateSelection();
        return;
      }
      if (meta && event.key === '0') {
        event.preventDefault();
        setViewport({ ...viewport, zoom: 1 });
        return;
      }
      if (meta && event.key === '1') {
        event.preventDefault();
        fitTo([]);
        return;
      }
      if (event.key === 'Delete' || event.key === 'Backspace') {
        if (selection.length === 0 && !selectedEdgeId) return;
        event.preventDefault();
        removeSelection();
        return;
      }
      if (event.key === 'Escape') {
        setSelection([]);
        setSelectedEdgeId(null);
        setEditingNodeId(null);
        return;
      }

      if (event.key.startsWith('Arrow') && selection.length > 0 && !boardLocked) {
        event.preventDefault();
        const step = event.shiftKey ? NUDGE * 4 : NUDGE;
        const dx = event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0;
        const dy = event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0;

        commit((state) =>
          selection.reduce((board, id) => {
            const node = board.nodes.find((candidate) => candidate.id === id);
            return node ? moveNode(board, id, { x: node.x + dx, y: node.y + dy }) : board;
          }, state),
        );
      }
    };

    const onKeyUp = (event: KeyboardEvent) => {
      if (event.code === 'Space') setSpaceHeld(false);
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, [
    boardLocked,
    canvas,
    commit,
    duplicateSelection,
    fitTo,
    history,
    nodesById,
    onUpdate,
    removeSelection,
    selectedEdgeId,
    selection,
    setViewport,
    viewport,
  ]);

  useEffect(() => {
    const onPaste = (event: ClipboardEvent) => {
      if (isTypingTarget(event.target) || boardLocked) return;
      const file = [...(event.clipboardData?.items ?? [])]
        .find((item) => item.type.startsWith('image/'))
        ?.getAsFile();
      if (!file) return;

      event.preventDefault();
      void uploadImage(file, centreOfView());
    };

    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [boardLocked, centreOfView, uploadImage]);

  // ---------------------------------------------------------------------
  // Menus
  // ---------------------------------------------------------------------

  const boardMenuItems = (at: { x: number; y: number }): ContextMenuItem[] => [
    {
      label: strings.canvas.addModule,
      items: available.map((connector) => ({
        label: connector.label,
        disabled: !connector.canCreate,
        hint: connector.needsCredentials ? strings.canvas.needsSetup : undefined,
        onSelect: () => onAddModule(connector, at),
      })),
    },
    { label: strings.canvas.addText, onSelect: () => addText(at) },
    { label: strings.canvas.pasteImage, hint: 'Ctrl+V', disabled: true },
    { separator: true, label: 'sep-1' },
    { label: strings.canvas.fitAll, hint: 'Ctrl+1', onSelect: () => fitTo([]) },
    { label: strings.canvas.zoomReset, hint: 'Ctrl+0', onSelect: () => setViewport({ ...viewport, zoom: 1 }) },
    { separator: true, label: 'sep-2' },
    {
      label: strings.canvas.showGrid,
      checked: canvas.showGrid,
      onSelect: () => commit((state) => ({ ...state, showGrid: !state.showGrid })),
    },
    {
      label: strings.canvas.snapToGrid,
      checked: canvas.snap > 0,
      onSelect: () => commit((state) => ({ ...state, snap: state.snap > 0 ? 0 : 8 })),
    },
    {
      label: strings.canvas.lockBoard,
      checked: boardLocked,
      onSelect: () => commit((state) => ({ ...state, locked: !state.locked })),
    },
    ...(history.canUndo
      ? [{ label: strings.canvas.undo, hint: 'Ctrl+Z', onSelect: () => {
          const next = history.undo(canvas);
          if (next) onUpdate(() => next);
        } }]
      : []),
  ];

  const nodeMenuItems = (node: CanvasNode): ContextMenuItem[] => {
    const screen = node.screenId ? screensById.get(node.screenId) : null;
    const members = node.screenId ? nodes.filter((other) => other.screenId === node.screenId).map((other) => other.id) : [];

    return [
      ...(node.kind === 'text'
        ? [{ label: strings.canvas.editText, onSelect: () => setEditingNodeId(node.id) }]
        : []),
      ...(node.kind === 'widget'
        ? [
            {
              label: strings.canvas.renameModule,
              onSelect: () => {
                const instance = instancesById.get((node as WidgetNode).instanceId);
                const title = window.prompt(strings.canvas.renamePrompt, (node as WidgetNode).title ?? instance?.label ?? '');
                if (title !== null) commit((state) => updateNode(state, node.id, { title: title.trim() || null }));
              },
            },
          ]
        : []),
      { label: strings.canvas.duplicate, hint: 'Ctrl+D', onSelect: () => commit((state) => duplicateNode(state, node.id)) },
      {
        label: node.locked ? strings.canvas.unlockNode : strings.canvas.lockNode,
        onSelect: () => commit((state) => setNodeLocked(state, node.id, !node.locked)),
      },
      { separator: true, label: 'sep-1' },
      { label: strings.canvas.bringToFront, onSelect: () => commit((state) => bringToFront(state, node.id)) },
      { label: strings.canvas.sendToBack, onSelect: () => commit((state) => sendToBack(state, node.id)) },
      ...(screen
        ? [
            { separator: true, label: 'sep-2' },
            {
              label: strings.canvas.renameScreen,
              hint: screen.name,
              onSelect: () => {
                const name = window.prompt(strings.canvas.renameScreenPrompt, screen.name);
                if (name) commit((state) => renameScreen(state, screen.id, name));
              },
            },
            { label: strings.canvas.fitScreen, onSelect: () => fitTo(members) },
          ]
        : []),
      { separator: true, label: 'sep-3' },
      { label: strings.dashboard.removeWidget, danger: true, hint: 'Del', onSelect: () => commit((state) => removeNode(state, node.id)) },
    ];
  };

  const edgeMenuItems = (edgeId: string): ContextMenuItem[] => {
    const edge = edges.find((candidate) => candidate.id === edgeId);
    return [
      {
        label: strings.canvas.labelLink,
        onSelect: () => {
          const label = window.prompt(strings.canvas.labelLinkPrompt, edge?.label ?? '');
          if (label !== null) commit((state) => setEdgeLabel(state, edgeId, label.trim()));
        },
      },
      { label: strings.canvas.removeLink, danger: true, onSelect: () => commit((state) => disconnectEdge(state, edgeId)) },
    ];
  };

  // ---------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------

  const layerStyle: CSSProperties = {
    transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.zoom})`,
  };

  const backgroundStyle: CSSProperties = canvas.showGrid
    ? {
        backgroundSize: `${GRID_STEP * viewport.zoom}px ${GRID_STEP * viewport.zoom}px`,
        backgroundPosition: `${viewport.x}px ${viewport.y}px`,
      }
    : { backgroundImage: 'none' };

  const sorted = [...nodes].sort((a, b) => a.z - b.z);
  const firstOfScreen = new Map<string, string>();
  for (const node of sorted) {
    if (node.screenId && !firstOfScreen.has(node.screenId)) firstOfScreen.set(node.screenId, node.id);
  }

  const className = [
    'eve-canvas',
    boardLocked ? 'is-locked' : null,
    spaceHeld ? 'is-panning' : null,
    pendingLink ? 'is-linking' : null,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div
      ref={containerRef}
      className={className}
      style={backgroundStyle}
      onPointerDown={handleBackgroundPointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      onWheel={handleWheel}
      onContextMenu={(event) => {
        if ((event.target as HTMLElement).closest('[data-node-id]')) return;
        menu.open(event, boardMenuItems(screenPointToBoard(event.clientX, event.clientY)));
      }}
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => {
        const file = [...event.dataTransfer.files].find((candidate) => candidate.type.startsWith('image/'));
        if (!file || boardLocked) return;
        event.preventDefault();
        void uploadImage(file, screenPointToBoard(event.clientX, event.clientY));
      }}
    >
      <div className="eve-canvas__layer" style={layerStyle}>
        <CanvasEdges
          nodes={nodes}
          edges={edges}
          screens={screens}
          selectedEdgeId={selectedEdgeId}
          pending={pendingLink}
          onSelectEdge={setSelectedEdgeId}
          onEdgeContextMenu={(event, edgeId) => {
            setSelectedEdgeId(edgeId);
            menu.open(event, edgeMenuItems(edgeId));
          }}
        />

        {sorted.map((node) => {
          const moving = movePreview?.ids.includes(node.id) ? { dx: movePreview.dx, dy: movePreview.dy } : null;
          const sizing = resizePreview?.id === node.id ? { w: resizePreview.w, h: resizePreview.h } : null;
          const screen = node.screenId ? screensById.get(node.screenId) : null;

          return (
            <CanvasNodeView
              key={node.id}
              node={node}
              selected={selection.includes(node.id)}
              boardLocked={boardLocked}
              screenName={screen && firstOfScreen.get(screen.id) === node.id ? screen.name : null}
              editing={editingNodeId === node.id}
              offset={moving}
              size={sizing}
              onPointerDownNode={handleNodePointerDown}
              onPointerDownResize={handleResizePointerDown}
              onPointerDownConnect={handleConnectPointerDown}
              onContextMenu={(event, nodeId) => {
                const subject = nodesById.get(nodeId);
                if (!subject) return;
                setSelection([nodeId]);
                menu.open(event, nodeMenuItems(subject));
              }}
              onStartEditing={setEditingNodeId}
              onTextChange={(nodeId, text) => onUpdate((state) => updateNode(state, nodeId, { text }))}
              onStopEditing={() => setEditingNodeId(null)}
            >
              {node.kind === 'widget' ? (widgetContent.get(node.id) ?? null) : null}
            </CanvasNodeView>
          );
        })}

        {marquee && marquee.w > 2 && (
          <div
            className="eve-canvas__marquee"
            style={{ left: marquee.x, top: marquee.y, width: marquee.w, height: marquee.h }}
          />
        )}
      </div>

      {nodes.length === 0 && (
        <div className="eve-canvas__empty">
          <p className="eve-empty__title">{strings.canvas.empty}</p>
          <p className="eve-dim">{strings.canvas.emptyHint}</p>
        </div>
      )}

      <div className="eve-canvas__hud">
        {uploading && <span className="eve-dim">{strings.canvas.uploading}</span>}
        {boardLocked && <span className="eve-canvas__hud-flag">{strings.canvas.lockedBoard}</span>}
        <button type="button" className="eve-btn" onClick={() => fitTo([])} title={strings.canvas.fitAll}>
          {strings.canvas.fitAllShort}
        </button>
        <span className="eve-canvas__zoom">{Math.round(viewport.zoom * 100)}%</span>
      </div>

      {menu.render()}
    </div>
  );
}
