import { z } from 'zod';
import type { DashboardConfig, WidgetLayout } from './dashboard-config';
import { viewConfigSchema, type ViewConfig } from './widget-view';

/**
 * The freeform board.
 *
 * The 12-column grid in dashboard-config.ts keys every tile by its
 * ConnectorInstance id, which is precisely why it can only ever show one
 * widget per connector instance. Here a node has its own id and merely
 * *references* an instance, so the same module can appear as many times as
 * the user likes — two Notion views side by side, the same table pinned next
 * to three different notes.
 *
 * Geometry is in board pixels, not grid cells: the viewport transform
 * (pan + zoom) is the only thing that maps them to screen pixels, so a node's
 * stored position never changes when the user zooms.
 */

/** Board pixels. Small enough to place precisely, large enough to stay legible when zoomed out. */
export const NODE_MIN_W = 160;
export const NODE_MIN_H = 80;
export const DEFAULT_WIDGET_NODE = { w: 420, h: 320 };
export const DEFAULT_TEXT_NODE = { w: 360, h: 72 };
export const DEFAULT_IMAGE_NODE = { w: 360, h: 240 };

export const MIN_ZOOM = 0.2;
export const MAX_ZOOM = 2.5;

const nodeBaseSchema = z.object({
  id: z.string().min(1),
  x: z.number(),
  y: z.number(),
  w: z.number().min(NODE_MIN_W),
  h: z.number().min(NODE_MIN_H),
  /** Paint order. Higher wins; ties fall back to array order. */
  z: z.number().int().default(0),
  /** Locked nodes can't be dragged, resized or deleted until unlocked. */
  locked: z.boolean().default(false),
  /**
   * Which "tela" this node belongs to, or null for a loose node. Set by
   * connecting nodes together — see `connectNodes`.
   */
  screenId: z.string().nullable().default(null),
});

/**
 * A module. `instanceId` points at a ConnectorInstance; several nodes may
 * point at the same one, in which case they are genuinely the same data
 * rendered twice (a mirror), which is the cheap and predictable reading of
 * "two widgets of the same type".
 *
 * `title` and `viewConfig` live on the node rather than in
 * `dashboardConfig.widgets[instanceId]` for the same reason: two nodes over
 * one instance must be allowed to show different fields.
 */
export const widgetNodeSchema = nodeBaseSchema.extend({
  kind: z.literal('widget'),
  instanceId: z.string().min(1),
  title: z.string().nullable().default(null),
  viewConfig: viewConfigSchema.nullable().default(null),
});

/** Loose text: a heading or a caption straight on the board, no chrome behind it. */
export const textNodeSchema = nodeBaseSchema.extend({
  kind: z.literal('text'),
  text: z.string().default(''),
  /** Board pixels, scaled by the viewport like everything else. */
  fontSize: z.number().min(8).max(160).default(18),
  weight: z.enum(['regular', 'bold']).default('regular'),
  align: z.enum(['left', 'center', 'right']).default('left'),
  color: z.string().nullable().default(null),
});

/** A pasted or dropped image, stored as an uploaded URL — never as a data URI in the config. */
export const imageNodeSchema = nodeBaseSchema.extend({
  kind: z.literal('image'),
  url: z.string().min(1),
  alt: z.string().default(''),
});

export const canvasNodeSchema = z.discriminatedUnion('kind', [
  widgetNodeSchema,
  textNodeSchema,
  imageNodeSchema,
]);

/**
 * A link between two nodes. Direction is kept (`from` → `to`) because an
 * arrow that documents "this feeds that" is worth more than a plain line,
 * but nothing downstream treats it as data flow yet.
 */
export const canvasEdgeSchema = z.object({
  id: z.string().min(1),
  from: z.string().min(1),
  to: z.string().min(1),
  label: z.string().default(''),
});

/**
 * A "tela": the named group that appears when modules are connected.
 *
 * Membership is stored on the nodes (`screenId`) rather than as a list here,
 * so there is exactly one place that can be wrong. The name lives here so it
 * survives adding and removing members — a purely derived connected
 * component would lose its name the moment the graph changed shape.
 */
export const canvasScreenSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  color: z.string().nullable().default(null),
});

export const canvasViewportSchema = z.object({
  x: z.number().default(0),
  y: z.number().default(0),
  zoom: z.number().min(MIN_ZOOM).max(MAX_ZOOM).default(1),
});

export const canvasStateSchema = z.object({
  nodes: z.array(canvasNodeSchema).default([]),
  edges: z.array(canvasEdgeSchema).default([]),
  screens: z.array(canvasScreenSchema).default([]),
  viewport: canvasViewportSchema.default({ x: 0, y: 0, zoom: 1 }),
  /** Board-wide lock: nothing moves until it's off, independent of per-node locks. */
  locked: z.boolean().default(false),
  showGrid: z.boolean().default(true),
  /** Snap step in board pixels. 0 = free placement. */
  snap: z.number().min(0).max(200).default(8),
});

export type WidgetNode = z.infer<typeof widgetNodeSchema>;
export type TextNode = z.infer<typeof textNodeSchema>;
export type ImageNode = z.infer<typeof imageNodeSchema>;
export type CanvasNode = z.infer<typeof canvasNodeSchema>;
export type CanvasNodeKind = CanvasNode['kind'];
export type CanvasEdge = z.infer<typeof canvasEdgeSchema>;
export type CanvasScreen = z.infer<typeof canvasScreenSchema>;
export type CanvasViewport = z.infer<typeof canvasViewportSchema>;
export type CanvasState = z.infer<typeof canvasStateSchema>;

export const emptyCanvasState: CanvasState = {
  nodes: [],
  edges: [],
  screens: [],
  viewport: { x: 0, y: 0, zoom: 1 },
  locked: false,
  showGrid: true,
  snap: 8,
};

/**
 * Ids are generated here rather than by the caller so every entry point
 * (right-click menu, palette, paste, migration) produces the same shape.
 * `crypto.randomUUID` needs a secure context in the browser, which an app
 * served over plain HTTP on a LAN address is not — hence the fallback.
 */
export function canvasId(prefix: string): string {
  const random =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
  return `${prefix}_${random}`;
}

function topZ(state: CanvasState): number {
  return state.nodes.reduce((max, node) => Math.max(max, node.z), 0);
}

export function snapValue(value: number, snap: number): number {
  return snap > 0 ? Math.round(value / snap) * snap : value;
}

// ---------------------------------------------------------------------------
// Nodes
// ---------------------------------------------------------------------------

export function addNode(state: CanvasState, node: CanvasNode): CanvasState {
  return { ...state, nodes: [...state.nodes, { ...node, z: topZ(state) + 1 }] };
}

export function createWidgetNode(
  instanceId: string,
  at: { x: number; y: number },
  size: { w: number; h: number } = DEFAULT_WIDGET_NODE,
): WidgetNode {
  return {
    id: canvasId('node'),
    kind: 'widget',
    instanceId,
    title: null,
    viewConfig: null,
    x: at.x,
    y: at.y,
    w: Math.max(size.w, NODE_MIN_W),
    h: Math.max(size.h, NODE_MIN_H),
    z: 0,
    locked: false,
    screenId: null,
  };
}

export function createTextNode(at: { x: number; y: number }, text = ''): TextNode {
  return {
    id: canvasId('text'),
    kind: 'text',
    text,
    fontSize: 18,
    weight: 'regular',
    align: 'left',
    color: null,
    x: at.x,
    y: at.y,
    ...DEFAULT_TEXT_NODE,
    z: 0,
    locked: false,
    screenId: null,
  };
}

export function createImageNode(url: string, at: { x: number; y: number }, size = DEFAULT_IMAGE_NODE): ImageNode {
  return {
    id: canvasId('img'),
    kind: 'image',
    url,
    alt: '',
    x: at.x,
    y: at.y,
    w: Math.max(size.w, NODE_MIN_W),
    h: Math.max(size.h, NODE_MIN_H),
    z: 0,
    locked: false,
    screenId: null,
  };
}

/** Patches one node. A locked node only accepts `locked` itself, so nothing can move it by accident. */
export function updateNode(state: CanvasState, nodeId: string, patch: Partial<CanvasNode>): CanvasState {
  return {
    ...state,
    nodes: state.nodes.map((node) => {
      if (node.id !== nodeId) return node;
      if (node.locked && !('locked' in patch)) return node;
      return { ...node, ...patch } as CanvasNode;
    }),
  };
}

export function moveNode(state: CanvasState, nodeId: string, at: { x: number; y: number }): CanvasState {
  return updateNode(state, nodeId, { x: snapValue(at.x, state.snap), y: snapValue(at.y, state.snap) });
}

export function resizeNode(state: CanvasState, nodeId: string, size: { w: number; h: number }): CanvasState {
  return updateNode(state, nodeId, {
    w: Math.max(snapValue(size.w, state.snap), NODE_MIN_W),
    h: Math.max(snapValue(size.h, state.snap), NODE_MIN_H),
  });
}

export function setNodeLocked(state: CanvasState, nodeId: string, locked: boolean): CanvasState {
  return updateNode(state, nodeId, { locked });
}

export function bringToFront(state: CanvasState, nodeId: string): CanvasState {
  return { ...state, nodes: state.nodes.map((node) => (node.id === nodeId ? { ...node, z: topZ(state) + 1 } : node)) };
}

export function sendToBack(state: CanvasState, nodeId: string): CanvasState {
  const lowest = state.nodes.reduce((min, node) => Math.min(min, node.z), 0);
  return { ...state, nodes: state.nodes.map((node) => (node.id === nodeId ? { ...node, z: lowest - 1 } : node)) };
}

/**
 * Removing a node takes its edges with it, then re-checks the tela it was in:
 * losing a node can break one group into two, or leave a single node that is
 * no longer a group at all.
 */
export function removeNode(state: CanvasState, nodeId: string): CanvasState {
  const target = state.nodes.find((node) => node.id === nodeId);
  if (!target || target.locked) return state;

  const next: CanvasState = {
    ...state,
    nodes: state.nodes.filter((node) => node.id !== nodeId),
    edges: state.edges.filter((edge) => edge.from !== nodeId && edge.to !== nodeId),
  };
  return resettleScreens(next);
}

/**
 * Duplicates a node slightly offset from the original. The copy is loose: it
 * inherits no edges, so it starts outside every tela — duplicating a module
 * shouldn't silently enlarge a group the user curated.
 */
export function duplicateNode(state: CanvasState, nodeId: string, offset = 32): CanvasState {
  const source = state.nodes.find((node) => node.id === nodeId);
  if (!source) return state;

  const prefix = source.kind === 'widget' ? 'node' : source.kind === 'text' ? 'text' : 'img';
  const copy = {
    ...source,
    id: canvasId(prefix),
    x: source.x + offset,
    y: source.y + offset,
    locked: false,
    screenId: null,
  } as CanvasNode;

  return addNode(state, copy);
}

// ---------------------------------------------------------------------------
// Edges and telas
// ---------------------------------------------------------------------------

function neighbours(state: CanvasState): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>();
  const touch = (id: string) => {
    if (!map.has(id)) map.set(id, new Set());
    return map.get(id)!;
  };

  for (const node of state.nodes) touch(node.id);
  for (const edge of state.edges) {
    if (!map.has(edge.from) || !map.has(edge.to)) continue;
    touch(edge.from).add(edge.to);
    touch(edge.to).add(edge.from);
  }
  return map;
}

/** Every connected component with at least two nodes, as node-id sets. */
export function connectedComponents(state: CanvasState): string[][] {
  const graph = neighbours(state);
  const seen = new Set<string>();
  const components: string[][] = [];

  for (const id of graph.keys()) {
    if (seen.has(id)) continue;

    const stack = [id];
    const component: string[] = [];
    seen.add(id);

    while (stack.length > 0) {
      const current = stack.pop()!;
      component.push(current);
      for (const next of graph.get(current) ?? []) {
        if (seen.has(next)) continue;
        seen.add(next);
        stack.push(next);
      }
    }

    if (component.length > 1) components.push(component);
  }

  return components;
}

function defaultScreenName(state: CanvasState): string {
  const used = new Set(state.screens.map((screen) => screen.name));
  for (let index = 1; index < 1000; index += 1) {
    const candidate = `Tela ${index}`;
    if (!used.has(candidate)) return candidate;
  }
  return `Tela ${state.screens.length + 1}`;
}

/**
 * Recomputes tela membership from the edges, which is the one place that
 * decides what a tela *is*:
 *
 * - a component whose members already share a tela keeps it;
 * - a component spanning two telas is a merge — the one with the most members
 *   in this component wins, so the bigger group keeps its name;
 * - a component with no tela gets a fresh one;
 * - a node that is no longer connected to anything leaves its tela;
 * - a tela nobody belongs to is dropped.
 *
 * Components are settled biggest-first, and a tela can only be claimed once:
 * when one tela splits in two, both halves would otherwise have an equal
 * claim to the original name, and the larger half is the better keeper of it.
 */
export function resettleScreens(state: CanvasState): CanvasState {
  const components = [...connectedComponents(state)].sort((a, b) => b.length - a.length);
  const byId = new Map(state.nodes.map((node) => [node.id, node]));
  const assignment = new Map<string, string>();
  const claimed = new Set<string>();
  let screens = [...state.screens];
  let working: CanvasState = state;

  for (const component of components) {
    const votes = new Map<string, number>();
    for (const id of component) {
      const existing = byId.get(id)?.screenId;
      if (existing && !claimed.has(existing)) votes.set(existing, (votes.get(existing) ?? 0) + 1);
    }

    let screenId = [...votes.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
    if (!screenId || !screens.some((screen) => screen.id === screenId)) {
      screenId = canvasId('screen');
      // The name is chosen against the screens accumulated so far, not the
      // original list, so two new telas in one pass don't collide.
      working = { ...working, screens };
      screens = [...screens, { id: screenId, name: defaultScreenName(working), color: null }];
    }

    claimed.add(screenId);
    for (const id of component) assignment.set(id, screenId);
  }

  const nodes = state.nodes.map((node) => {
    const screenId = assignment.get(node.id) ?? null;
    return node.screenId === screenId ? node : ({ ...node, screenId } as CanvasNode);
  });

  const live = new Set(assignment.values());
  return { ...state, nodes, screens: screens.filter((screen) => live.has(screen.id)) };
}

/**
 * Connects two nodes, which is how a tela comes into existence: the user
 * draws a link and the connected modules become a named group that Ctrl+K can
 * find and fly to.
 */
export function connectNodes(state: CanvasState, from: string, to: string, label = ''): CanvasState {
  if (from === to) return state;
  if (!state.nodes.some((node) => node.id === from) || !state.nodes.some((node) => node.id === to)) return state;

  // One link per pair, in either direction: a second arrow between the same
  // two modules says nothing new and doubles the hit area.
  const exists = state.edges.some(
    (edge) => (edge.from === from && edge.to === to) || (edge.from === to && edge.to === from),
  );
  if (exists) return state;

  return resettleScreens({ ...state, edges: [...state.edges, { id: canvasId('edge'), from, to, label }] });
}

export function disconnectEdge(state: CanvasState, edgeId: string): CanvasState {
  if (!state.edges.some((edge) => edge.id === edgeId)) return state;
  return resettleScreens({ ...state, edges: state.edges.filter((edge) => edge.id !== edgeId) });
}

export function setEdgeLabel(state: CanvasState, edgeId: string, label: string): CanvasState {
  return { ...state, edges: state.edges.map((edge) => (edge.id === edgeId ? { ...edge, label } : edge)) };
}

export function renameScreen(state: CanvasState, screenId: string, name: string): CanvasState {
  const trimmed = name.trim();
  if (!trimmed) return state;
  return {
    ...state,
    screens: state.screens.map((screen) => (screen.id === screenId ? { ...screen, name: trimmed } : screen)),
  };
}

export function screenMembers(state: CanvasState, screenId: string): CanvasNode[] {
  return state.nodes.filter((node) => node.screenId === screenId);
}

// ---------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------

export interface Bounds {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function boundsOf(nodes: CanvasNode[]): Bounds | null {
  if (nodes.length === 0) return null;

  const minX = Math.min(...nodes.map((node) => node.x));
  const minY = Math.min(...nodes.map((node) => node.y));
  const maxX = Math.max(...nodes.map((node) => node.x + node.w));
  const maxY = Math.max(...nodes.map((node) => node.y + node.h));
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

/**
 * The viewport that frames `bounds` inside a viewport of `size`, which is
 * what "jump to this tela" does after Ctrl+K picks one.
 *
 * Framing never zooms in past 100%: blowing a two-module tela up to 250%
 * because it happens to fit reads as a bug, so a small tela is shown at its
 * natural size and merely centred.
 */
export function viewportForBounds(
  bounds: Bounds,
  size: { width: number; height: number },
  padding = 80,
  maxZoom = 1,
): CanvasViewport {
  const zoom = Math.min(
    Math.min(maxZoom, MAX_ZOOM),
    Math.max(MIN_ZOOM, Math.min(size.width / (bounds.w + padding * 2), size.height / (bounds.h + padding * 2))),
  );
  return {
    zoom,
    x: size.width / 2 - (bounds.x + bounds.w / 2) * zoom,
    y: size.height / 2 - (bounds.y + bounds.h / 2) * zoom,
  };
}

/** Screen point → board point, for placing a node where the user right-clicked. */
export function toBoardPoint(
  point: { x: number; y: number },
  viewport: CanvasViewport,
): { x: number; y: number } {
  return { x: (point.x - viewport.x) / viewport.zoom, y: (point.y - viewport.y) / viewport.zoom };
}

// ---------------------------------------------------------------------------
// Migration off the grid
// ---------------------------------------------------------------------------

/** Board pixels per grid column/row, chosen so a migrated board looks like the grid it came from. */
const GRID_COL_W = 110;
const GRID_ROW_H = 44;

/**
 * Lays the user's existing 12-column grid out on the board, once, so
 * switching to the canvas doesn't greet them with an empty page. Per-instance
 * titles and view configs come along, since on the board they live on the
 * node.
 */
export function canvasFromGrid(layout: WidgetLayout[], widgets: DashboardConfig['widgets']): CanvasState {
  const nodes: CanvasNode[] = layout.map((item, index) => {
    const settings = widgets[item.i];
    return {
      id: canvasId('node'),
      kind: 'widget',
      instanceId: item.i,
      title: settings?.title ?? null,
      viewConfig: settings?.viewConfig ?? null,
      x: item.x * GRID_COL_W,
      y: item.y * GRID_ROW_H,
      w: Math.max(item.w * GRID_COL_W, NODE_MIN_W),
      h: Math.max(item.h * GRID_ROW_H, NODE_MIN_H),
      z: index,
      locked: false,
      screenId: null,
    } satisfies WidgetNode;
  });

  return { ...emptyCanvasState, nodes };
}

/** The effective view config for a widget node, preferring the node's own over the instance-wide one. */
export function nodeViewConfig(node: WidgetNode, fallback: ViewConfig | null): ViewConfig | null {
  return node.viewConfig ?? fallback;
}
