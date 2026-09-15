import { describe, expect, it } from 'vitest';
import {
  addNode,
  boundsOf,
  canvasFromGrid,
  connectNodes,
  createTextNode,
  createWidgetNode,
  disconnectEdge,
  duplicateNode,
  emptyCanvasState,
  moveNode,
  removeNode,
  renameScreen,
  resizeNode,
  screenMembers,
  setNodeLocked,
  toBoardPoint,
  viewportForBounds,
  type CanvasState,
} from './canvas';
import { parseDashboardConfig } from './dashboard-config';

/** Three loose widget nodes, so every test starts from the same board. */
function boardOfThree(): { state: CanvasState; ids: [string, string, string] } {
  let state = emptyCanvasState;
  const ids: string[] = [];

  for (let index = 0; index < 3; index += 1) {
    const node = createWidgetNode(`instance-${index}`, { x: index * 500, y: 0 });
    ids.push(node.id);
    state = addNode(state, node);
  }

  return { state, ids: ids as [string, string, string] };
}

describe('canvas nodes', () => {
  it('lets the same connector instance appear more than once', () => {
    let state = emptyCanvasState;
    state = addNode(state, createWidgetNode('instance-1', { x: 0, y: 0 }));
    state = addNode(state, createWidgetNode('instance-1', { x: 600, y: 0 }));

    expect(state.nodes).toHaveLength(2);
    expect(new Set(state.nodes.map((node) => node.id)).size).toBe(2);
    expect(state.nodes.every((node) => node.kind === 'widget' && node.instanceId === 'instance-1')).toBe(true);
  });

  it('stacks each new node above the last', () => {
    const { state } = boardOfThree();
    const zs = state.nodes.map((node) => node.z);
    expect(zs).toEqual([...zs].sort((a, b) => a - b));
    expect(new Set(zs).size).toBe(3);
  });

  it('snaps position and size to the board step', () => {
    const { state, ids } = boardOfThree();

    const moved = moveNode(state, ids[0], { x: 103, y: 97 });
    expect(moved.nodes[0]).toMatchObject({ x: 104, y: 96 });

    const resized = resizeNode(moved, ids[0], { w: 301, h: 205 });
    expect(resized.nodes[0]).toMatchObject({ w: 304, h: 208 });
  });

  it('never resizes below the minimum, whatever the drag says', () => {
    const { state, ids } = boardOfThree();
    const resized = resizeNode(state, ids[0], { w: 10, h: 10 });
    expect(resized.nodes[0]!.w).toBeGreaterThanOrEqual(160);
    expect(resized.nodes[0]!.h).toBeGreaterThanOrEqual(80);
  });

  it('refuses to move, resize or delete a locked node, but can still unlock it', () => {
    const { state, ids } = boardOfThree();
    const locked = setNodeLocked(state, ids[0], true);

    expect(moveNode(locked, ids[0], { x: 900, y: 900 }).nodes[0]).toMatchObject({ x: 0, y: 0 });
    expect(removeNode(locked, ids[0]).nodes).toHaveLength(3);

    const unlocked = setNodeLocked(locked, ids[0], false);
    expect(moveNode(unlocked, ids[0], { x: 800, y: 0 }).nodes[0]).toMatchObject({ x: 800 });
  });

  it('duplicates a node loose, without dragging it into the original tela', () => {
    const { state, ids } = boardOfThree();
    const connected = connectNodes(state, ids[0], ids[1]);
    const screenId = connected.nodes[0]!.screenId;
    expect(screenId).toBeTruthy();

    const duplicated = duplicateNode(connected, ids[0]);
    const copy = duplicated.nodes.at(-1)!;

    expect(duplicated.nodes).toHaveLength(4);
    expect(copy.id).not.toBe(ids[0]);
    expect(copy.screenId).toBeNull();
    expect(duplicated.edges).toHaveLength(1);
  });
});

describe('telas', () => {
  it('creates one when two nodes are first connected', () => {
    const { state, ids } = boardOfThree();
    const connected = connectNodes(state, ids[0], ids[1]);

    expect(connected.screens).toHaveLength(1);
    expect(connected.screens[0]!.name).toBe('Tela 1');
    expect(screenMembers(connected, connected.screens[0]!.id).map((node) => node.id).sort()).toEqual(
      [ids[0], ids[1]].sort(),
    );
    // The third node is loose until something links it.
    expect(connected.nodes.find((node) => node.id === ids[2])!.screenId).toBeNull();
  });

  it('adopts the existing tela when a third node joins', () => {
    const { state, ids } = boardOfThree();
    let next = connectNodes(state, ids[0], ids[1]);
    const screenId = next.screens[0]!.id;

    next = connectNodes(next, ids[1], ids[2]);

    expect(next.screens).toHaveLength(1);
    expect(next.screens[0]!.id).toBe(screenId);
    expect(screenMembers(next, screenId)).toHaveLength(3);
  });

  it('keeps the bigger tela name when two telas merge', () => {
    let state = emptyCanvasState;
    const nodes = Array.from({ length: 4 }, (_, index) => createWidgetNode(`instance-${index}`, { x: index * 500, y: 0 }));
    for (const node of nodes) state = addNode(state, node);

    // Two telas: {0,1,2} named by hand, and {3} joined to nothing yet.
    state = connectNodes(state, nodes[0]!.id, nodes[1]!.id);
    state = connectNodes(state, nodes[1]!.id, nodes[2]!.id);
    const big = state.screens[0]!.id;
    state = renameScreen(state, big, 'Performance');

    // A separate pair, so there are genuinely two telas before the merge.
    let other = addNode(state, createWidgetNode('instance-4', { x: 2500, y: 0 }));
    const loose = other.nodes.at(-1)!.id;
    other = connectNodes(other, nodes[3]!.id, loose);
    expect(other.screens).toHaveLength(2);

    // Bridge the two groups: the three-member side should win the name.
    const merged = connectNodes(other, nodes[2]!.id, nodes[3]!.id);

    expect(merged.screens).toHaveLength(1);
    expect(merged.screens[0]!.id).toBe(big);
    expect(merged.screens[0]!.name).toBe('Performance');
    expect(screenMembers(merged, big)).toHaveLength(5);
  });

  it('splits a tela in two when the bridging link is cut', () => {
    let state = emptyCanvasState;
    const nodes = Array.from({ length: 4 }, (_, index) => createWidgetNode(`instance-${index}`, { x: index * 500, y: 0 }));
    for (const node of nodes) state = addNode(state, node);

    state = connectNodes(state, nodes[0]!.id, nodes[1]!.id);
    state = connectNodes(state, nodes[2]!.id, nodes[3]!.id);
    const bridge = connectNodes(state, nodes[1]!.id, nodes[2]!.id);
    expect(bridge.screens).toHaveLength(1);

    const bridgeEdge = bridge.edges.find((edge) => edge.from === nodes[1]!.id && edge.to === nodes[2]!.id)!;
    const split = disconnectEdge(bridge, bridgeEdge.id);

    expect(split.screens).toHaveLength(2);
    const groups = split.screens.map((screen) => screenMembers(split, screen.id).length);
    expect(groups).toEqual([2, 2]);
  });

  it('drops the tela entirely once the last link goes', () => {
    const { state, ids } = boardOfThree();
    const connected = connectNodes(state, ids[0], ids[1]);
    const cut = disconnectEdge(connected, connected.edges[0]!.id);

    expect(cut.screens).toHaveLength(0);
    expect(cut.nodes.every((node) => node.screenId === null)).toBe(true);
  });

  it('re-checks the tela when a member node is deleted', () => {
    const { state, ids } = boardOfThree();
    let next = connectNodes(state, ids[0], ids[1]);
    next = connectNodes(next, ids[1], ids[2]);

    // ids[1] is the middle of the chain: removing it leaves two loose nodes.
    const removed = removeNode(next, ids[1]);

    expect(removed.nodes).toHaveLength(2);
    expect(removed.edges).toHaveLength(0);
    expect(removed.screens).toHaveLength(0);
  });

  it('ignores a self-link and a duplicate link in either direction', () => {
    const { state, ids } = boardOfThree();

    expect(connectNodes(state, ids[0], ids[0]).edges).toHaveLength(0);

    const once = connectNodes(state, ids[0], ids[1]);
    expect(connectNodes(once, ids[0], ids[1]).edges).toHaveLength(1);
    expect(connectNodes(once, ids[1], ids[0]).edges).toHaveLength(1);
  });

  it('names new telas without colliding', () => {
    let state = emptyCanvasState;
    const nodes = Array.from({ length: 4 }, (_, index) => createWidgetNode(`instance-${index}`, { x: index * 500, y: 0 }));
    for (const node of nodes) state = addNode(state, node);

    state = connectNodes(state, nodes[0]!.id, nodes[1]!.id);
    state = connectNodes(state, nodes[2]!.id, nodes[3]!.id);

    expect(state.screens.map((screen) => screen.name).sort()).toEqual(['Tela 1', 'Tela 2']);
  });
});

describe('viewport', () => {
  it('frames a tela inside the viewport', () => {
    const bounds = { x: 0, y: 0, w: 1000, h: 500 };
    const viewport = viewportForBounds(bounds, { width: 1200, height: 800 });

    // Centre of the bounds lands at the centre of the viewport.
    const centre = toBoardPoint({ x: 600, y: 400 }, viewport);
    expect(centre.x).toBeCloseTo(500);
    expect(centre.y).toBeCloseTo(250);
    expect(viewport.zoom).toBeLessThanOrEqual(1);
  });

  it('never zooms past the limits, however small or large the tela', () => {
    const tiny = viewportForBounds({ x: 0, y: 0, w: 10, h: 10 }, { width: 1200, height: 800 });
    const huge = viewportForBounds({ x: 0, y: 0, w: 99_000, h: 99_000 }, { width: 1200, height: 800 });

    expect(tiny.zoom).toBeLessThanOrEqual(2.5);
    expect(huge.zoom).toBeGreaterThanOrEqual(0.2);
  });

  it('measures bounds across every kind of node', () => {
    const bounds = boundsOf([
      createWidgetNode('instance-1', { x: 100, y: 100 }),
      createTextNode({ x: -50, y: 900 }, 'titulo'),
    ]);

    expect(bounds).not.toBeNull();
    expect(bounds!.x).toBe(-50);
    expect(bounds!.y).toBe(100);
  });

  it('has no bounds for an empty selection', () => {
    expect(boundsOf([])).toBeNull();
  });
});

describe('migration off the grid', () => {
  it('turns grid tiles into board nodes, keeping titles and views', () => {
    const canvas = canvasFromGrid(
      [
        { i: 'instance-1', x: 0, y: 0, w: 6, h: 6 },
        { i: 'instance-2', x: 6, y: 0, w: 6, h: 4 },
      ],
      { 'instance-1': { title: 'Meu Notion', clientOverride: null, viewConfig: { kind: 'stat-cards', fields: null } } },
    );

    expect(canvas.nodes).toHaveLength(2);
    const [first, second] = canvas.nodes;
    expect(first).toMatchObject({ kind: 'widget', instanceId: 'instance-1', title: 'Meu Notion', x: 0, y: 0 });
    expect(first!.kind === 'widget' && first!.viewConfig?.kind).toBe('stat-cards');
    // Second tile sits to the right of the first, as it did on the grid.
    expect(second!.x).toBeGreaterThan(first!.x);
    expect(canvas.screens).toHaveLength(0);
  });

  it('defaults an old stored config to canvas mode with an empty board', () => {
    const config = parseDashboardConfig({ layout: [{ i: 'instance-1', x: 0, y: 0, w: 6, h: 6 }], theme: 'dark' });

    expect(config.mode).toBe('canvas');
    expect(config.canvas.nodes).toEqual([]);
    // The grid layout is preserved, so switching back to grid mode loses nothing.
    expect(config.layout).toHaveLength(1);
  });

  it('round-trips a board through the config parser', () => {
    let canvas = emptyCanvasState;
    const first = createWidgetNode('instance-1', { x: 0, y: 0 });
    const second = createWidgetNode('instance-1', { x: 600, y: 0 });
    canvas = connectNodes(addNode(addNode(canvas, first), second), first.id, second.id);

    const parsed = parseDashboardConfig({ mode: 'canvas', canvas });

    expect(parsed.canvas.nodes).toHaveLength(2);
    expect(parsed.canvas.edges).toHaveLength(1);
    expect(parsed.canvas.screens).toHaveLength(1);
  });
});
