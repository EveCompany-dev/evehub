'use client';

import type { CanvasEdge, CanvasNode, CanvasScreen } from '@eve/core/canvas';
import type { JSX, MouseEvent as ReactMouseEvent } from 'react';

export interface PendingLink {
  from: { x: number; y: number };
  to: { x: number; y: number };
}

export interface CanvasEdgesProps {
  nodes: CanvasNode[];
  edges: CanvasEdge[];
  screens: CanvasScreen[];
  selectedEdgeId: string | null;
  /** The link being dragged out of a node's handle, in board coordinates. */
  pending: PendingLink | null;
  onSelectEdge: (edgeId: string) => void;
  onEdgeContextMenu: (event: ReactMouseEvent, edgeId: string) => void;
}

function centre(node: CanvasNode): { x: number; y: number } {
  return { x: node.x + node.w / 2, y: node.y + node.h / 2 };
}

/**
 * Anchors the line on the side of each box that faces the other one, so a
 * link between two modules leaves and arrives at an edge rather than
 * emerging from under the middle of a widget.
 */
function anchor(from: CanvasNode, to: CanvasNode): { x: number; y: number } {
  const a = centre(from);
  const b = centre(to);
  const horizontal = Math.abs(b.x - a.x) >= Math.abs(b.y - a.y);

  if (horizontal) return { x: b.x > a.x ? from.x + from.w : from.x, y: a.y };
  return { x: a.x, y: b.y > a.y ? from.y + from.h : from.y };
}

/** A cubic whose control points lean along the dominant axis — the usual node-graph look. */
function path(a: { x: number; y: number }, b: { x: number; y: number }): string {
  const dx = Math.abs(b.x - a.x);
  const dy = Math.abs(b.y - a.y);
  const lean = Math.max(40, Math.min(dx, 220));

  if (dx >= dy) return `M ${a.x} ${a.y} C ${a.x + Math.sign(b.x - a.x) * lean} ${a.y}, ${b.x - Math.sign(b.x - a.x) * lean} ${b.y}, ${b.x} ${b.y}`;
  const leanY = Math.max(40, Math.min(dy, 220));
  return `M ${a.x} ${a.y} C ${a.x} ${a.y + Math.sign(b.y - a.y) * leanY}, ${b.x} ${b.y - Math.sign(b.y - a.y) * leanY}, ${b.x} ${b.y}`;
}

/**
 * The link layer, drawn underneath the nodes in board coordinates: the
 * viewport transform on the parent moves and scales it along with everything
 * else, and `vectorEffect` keeps the strokes a constant screen width so links
 * don't vanish when the board is zoomed out.
 */
export function CanvasEdges({
  nodes,
  edges,
  screens,
  selectedEdgeId,
  pending,
  onSelectEdge,
  onEdgeContextMenu,
}: CanvasEdgesProps): JSX.Element {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const colorOf = new Map(screens.map((screen) => [screen.id, screen.color]));

  return (
    <svg className="eve-canvas__edges" aria-hidden="true">
      {edges.map((edge) => {
        const from = byId.get(edge.from);
        const to = byId.get(edge.to);
        if (!from || !to) return null;

        const a = anchor(from, to);
        const b = anchor(to, from);
        const d = path(a, b);
        const colour = (from.screenId && colorOf.get(from.screenId)) || null;
        const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };

        return (
          <g key={edge.id} className={edge.id === selectedEdgeId ? 'eve-canvas__edge is-selected' : 'eve-canvas__edge'}>
            {/* A fat invisible copy under the visible line: a 2px bezier is
                almost impossible to hit with a mouse. */}
            <path
              d={d}
              className="eve-canvas__edge-hit"
              vectorEffect="non-scaling-stroke"
              onPointerDown={(event) => {
                event.stopPropagation();
                onSelectEdge(edge.id);
              }}
              onContextMenu={(event) => onEdgeContextMenu(event, edge.id)}
            />
            <path
              d={d}
              className="eve-canvas__edge-line"
              vectorEffect="non-scaling-stroke"
              style={colour ? { stroke: colour } : undefined}
            />
            {edge.label && (
              <text x={mid.x} y={mid.y - 6} className="eve-canvas__edge-label" textAnchor="middle">
                {edge.label}
              </text>
            )}
          </g>
        );
      })}

      {pending && (
        <path
          d={path(pending.from, pending.to)}
          className="eve-canvas__edge-line is-pending"
          vectorEffect="non-scaling-stroke"
        />
      )}
    </svg>
  );
}
