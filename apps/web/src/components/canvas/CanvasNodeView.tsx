'use client';

import type { CanvasNode } from '@eve/core/canvas';
import { Lock, strings } from '@eve/ui';
import { memo, useEffect, useRef, type CSSProperties, type JSX, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';

export interface CanvasNodeViewProps {
  node: CanvasNode;
  selected: boolean;
  /** Board-wide lock; a node is immovable if either this or its own lock is on. */
  boardLocked: boolean;
  /** Name of the tela this node belongs to, shown as a badge on the first member. */
  screenName: string | null;
  /** True while this text node is being edited in place. */
  editing: boolean;
  /** Live gesture feedback, in board pixels, applied without touching stored geometry. */
  offset: { dx: number; dy: number } | null;
  size: { w: number; h: number } | null;
  /** The widget itself, for widget nodes. A stable element, so dragging never re-renders it. */
  children?: ReactNode;
  onPointerDownNode: (event: ReactPointerEvent, nodeId: string, part: 'body' | 'handle') => void;
  onPointerDownResize: (event: ReactPointerEvent, nodeId: string) => void;
  onPointerDownConnect: (event: ReactPointerEvent, nodeId: string) => void;
  onContextMenu: (event: ReactMouseEvent, nodeId: string) => void;
  onStartEditing: (nodeId: string) => void;
  onTextChange: (nodeId: string, text: string) => void;
  onStopEditing: () => void;
}

function CanvasNodeViewImpl({
  node,
  selected,
  boardLocked,
  screenName,
  editing,
  offset,
  size,
  children,
  onPointerDownNode,
  onPointerDownResize,
  onPointerDownConnect,
  onContextMenu,
  onStartEditing,
  onTextChange,
  onStopEditing,
}: CanvasNodeViewProps): JSX.Element {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const immovable = boardLocked || node.locked;

  useEffect(() => {
    if (editing) textareaRef.current?.focus();
  }, [editing]);

  const style: CSSProperties = {
    left: node.x + (offset?.dx ?? 0),
    top: node.y + (offset?.dy ?? 0),
    width: size?.w ?? node.w,
    height: size?.h ?? node.h,
    zIndex: node.z,
  };

  const className = [
    'eve-canvas__node',
    `eve-canvas__node--${node.kind}`,
    selected ? 'is-selected' : null,
    node.locked ? 'is-locked' : null,
    offset || size ? 'is-dragging' : null,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div
      className={className}
      style={style}
      data-node-id={node.id}
      onContextMenu={(event) => onContextMenu(event, node.id)}
      // A widget node is dragged by the widget's own header (the same
      // `.eve-widget__header` handle the grid uses), so clicks inside a table
      // or a menu stay clicks. Text and image nodes have no chrome of their
      // own, so their whole body is the handle.
      onPointerDown={(event) => onPointerDownNode(event, node.id, node.kind === 'widget' ? 'body' : 'handle')}
    >
      {node.kind === 'widget' && children}

      {node.kind === 'text' &&
        (editing ? (
          <textarea
            ref={textareaRef}
            className="eve-canvas__text-input eve-no-drag"
            value={node.text}
            style={{ fontSize: node.fontSize, fontWeight: node.weight === 'bold' ? 700 : 400, textAlign: node.align }}
            onChange={(event) => onTextChange(node.id, event.target.value)}
            onBlur={onStopEditing}
            onKeyDown={(event) => {
              if (event.key === 'Escape') onStopEditing();
              event.stopPropagation();
            }}
            onPointerDown={(event) => event.stopPropagation()}
          />
        ) : (
          <div
            className="eve-canvas__text"
            style={{
              fontSize: node.fontSize,
              fontWeight: node.weight === 'bold' ? 700 : 400,
              textAlign: node.align,
              ...(node.color ? { color: node.color } : {}),
            }}
            onDoubleClick={() => !immovable && onStartEditing(node.id)}
          >
            {node.text || <span className="eve-dim">{strings.canvas.textPlaceholder}</span>}
          </div>
        ))}

      {node.kind === 'image' && (
        // Dragged by its own body, so the image must not swallow the gesture.
        // next/image buys nothing here: these are user uploads of unknown
        // size placed at an arbitrary board scale, and the same exemption is
        // already taken for the dashboard background preview.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={node.url} alt={node.alt} className="eve-canvas__image" draggable={false} />
      )}

      {screenName && <span className="eve-canvas__screen-badge">{screenName}</span>}
      {node.locked && (
        <span className="eve-canvas__lock-badge" title={strings.canvas.locked} aria-label={strings.canvas.locked}>
          <Lock size={14} aria-hidden="true" />
        </span>
      )}

      {!immovable && (
        <>
          {/* Drag out of this to link two modules into a tela. */}
          <button
            type="button"
            className="eve-canvas__connector eve-no-drag"
            title={strings.canvas.connectHint}
            aria-label={strings.canvas.connectHint}
            onPointerDown={(event) => onPointerDownConnect(event, node.id)}
          />
          <button
            type="button"
            className="eve-canvas__resize eve-no-drag"
            title={strings.canvas.resizeHint}
            aria-label={strings.canvas.resizeHint}
            onPointerDown={(event) => onPointerDownResize(event, node.id)}
          />
        </>
      )}
    </div>
  );
}

/**
 * Memoized on purpose: a pan or a drag re-renders the board on every pointer
 * move, and a widget node contains a live, fetching, sometimes heavy module.
 * `children` arrives as a cached element from the board, so as long as the
 * props below are unchanged React re-uses the whole widget subtree untouched.
 */
export const CanvasNodeView = memo(CanvasNodeViewImpl);
