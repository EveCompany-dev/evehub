'use client';

import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { AtSign, Circle, CircleCheck, GripVertical, Link2, strings, Trash2 } from '@eve/ui';
import Link from 'next/link';
import {
  useEffect,
  useRef,
  useState,
  type JSX,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import type { TodoRenderPart } from '../../lib/todo-tokens';
import type { TodoItemDto } from '../../lib/todo-types';
import { TodoEditor } from './TodoEditor';

/** How far left a finger has to pull a row before letting go asks to delete it. */
const SWIPE_THRESHOLD = 72;
/** Before this much movement a touch is still undecided between a swipe and a scroll. */
const SWIPE_SLOP = 8;

export interface TodoRowProps {
  item: TodoItemDto;
  parts: TodoRenderPart[];
  selected: boolean;
  editing: boolean;
  confirming: boolean;
  /** Manual sort: the drag handle shows. */
  sortable: boolean;
  onSelect: () => void;
  onToggleDone: () => void;
  onStartEdit: () => void;
  onSubmitEdit: (text: string) => void;
  onCancelEdit: () => void;
  onRequestDelete: () => void;
  onConfirmDelete: () => void;
  onCancelDelete: () => void;
  onContextMenu: (event: ReactMouseEvent) => void;
  /** Arrow keys on a selected row: -1 up, +1 down, 'first'/'last' for Home/End. */
  onNavigate: (to: -1 | 1 | 'first' | 'last') => void;
  registerRef: (node: HTMLLIElement | null) => void;
}

function formatDue(iso: string): string {
  return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
}

export function TodoRow({
  item,
  parts,
  selected,
  editing,
  confirming,
  sortable,
  onSelect,
  onToggleDone,
  onStartEdit,
  onSubmitEdit,
  onCancelEdit,
  onRequestDelete,
  onConfirmDelete,
  onCancelDelete,
  onContextMenu,
  onNavigate,
  registerRef,
}: TodoRowProps): JSX.Element {
  const pending = item.id.startsWith('tmp-');
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({
    id: item.id,
    disabled: !sortable || pending || editing || confirming,
  });

  const [swipeX, setSwipeX] = useState(0);
  const swipe = useRef<{ x: number; y: number; id: number; horizontal: boolean | null } | null>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (confirming) confirmRef.current?.focus();
  }, [confirming]);

  // Touch only: a mouse drag on a row is a text selection, not a swipe.
  const onPointerDown = (event: ReactPointerEvent<HTMLLIElement>) => {
    if (event.pointerType !== 'touch' || editing || confirming || pending) return;
    swipe.current = { x: event.clientX, y: event.clientY, id: event.pointerId, horizontal: null };
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLLIElement>) => {
    const start = swipe.current;
    if (!start || start.id !== event.pointerId) return;
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    if (start.horizontal === null) {
      if (Math.abs(dx) < SWIPE_SLOP && Math.abs(dy) < SWIPE_SLOP) return;
      start.horizontal = Math.abs(dx) > Math.abs(dy);
      if (!start.horizontal) {
        swipe.current = null;
        return;
      }
      event.currentTarget.setPointerCapture(event.pointerId);
    }
    setSwipeX(Math.min(0, Math.max(dx, -160)));
  };

  const endSwipe = (event: ReactPointerEvent<HTMLLIElement>) => {
    const start = swipe.current;
    swipe.current = null;
    if (!start || start.id !== event.pointerId) return;
    if (swipeX <= -SWIPE_THRESHOLD) onRequestDelete();
    setSwipeX(0);
  };

  const onKeyDown = (event: ReactKeyboardEvent<HTMLLIElement>) => {
    if (confirming) {
      // Focus sits on "Excluir", so Enter confirms natively; Escape backs out from anywhere in the row.
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        onCancelDelete();
      }
      return;
    }
    // Keys on the handle, the check button or a chip belong to them.
    if (event.target !== event.currentTarget) return;

    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        onNavigate(1);
        break;
      case 'ArrowUp':
        event.preventDefault();
        onNavigate(-1);
        break;
      case 'Home':
        event.preventDefault();
        onNavigate('first');
        break;
      case 'End':
        event.preventDefault();
        onNavigate('last');
        break;
      case 'Delete':
      case 'Backspace':
        event.preventDefault();
        event.stopPropagation();
        if (!pending) onRequestDelete();
        break;
      case 'Enter':
      case 'F2':
        event.preventDefault();
        event.stopPropagation();
        if (!pending) onStartEdit();
        break;
      case ' ':
        event.preventDefault();
        if (!pending) onToggleDone();
        break;
    }
  };

  const className = [
    'eve-todo__row',
    item.done ? 'is-done' : null,
    selected ? 'is-selected' : null,
    confirming ? 'is-confirming' : null,
    isDragging ? 'is-dragging' : null,
    swipeX < 0 ? 'is-swiping' : null,
    swipeX <= -SWIPE_THRESHOLD ? 'is-armed' : null,
    pending ? 'is-pending' : null,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <li
      ref={(node) => {
        setNodeRef(node);
        registerRef(node);
      }}
      className={className}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      tabIndex={selected ? 0 : -1}
      data-todo-id={item.id}
      onKeyDown={onKeyDown}
      onContextMenu={onContextMenu}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endSwipe}
      onPointerCancel={endSwipe}
      onMouseDown={(event) => {
        // A press on the row outside the text (and off its buttons/links) selects it for the keyboard.
        const target = event.target as HTMLElement;
        if (!target.closest('button, a, input, .eve-todo__text')) onSelect();
      }}
    >
      {confirming ? (
        <div className="eve-todo__confirm" role="group" aria-label={strings.todo.deleteConfirm}>
          <Trash2 size={14} aria-hidden="true" />
          <span className="eve-todo__confirm-text">{strings.todo.deleteConfirm}</span>
          <button type="button" className="eve-btn eve-todo__confirm-btn" onClick={onCancelDelete}>
            {strings.todo.deleteNo}
          </button>
          <button ref={confirmRef} type="button" className="eve-btn eve-btn--danger-solid eve-todo__confirm-btn" onClick={onConfirmDelete}>
            {strings.todo.deleteYes}
          </button>
        </div>
      ) : (
        <>
          <span className="eve-todo__swipe-hint" aria-hidden="true">
            <Trash2 size={16} />
            {strings.todo.deleteYes}
          </span>
          <div className="eve-todo__content" style={swipeX ? { transform: `translateX(${swipeX}px)` } : undefined}>
            {sortable && (
              <button
                ref={setActivatorNodeRef}
                type="button"
                className="eve-todo__handle eve-no-drag"
                aria-label={strings.todo.drag}
                title={strings.todo.drag}
                disabled={pending}
                {...attributes}
                {...listeners}
              >
                <GripVertical size={14} aria-hidden="true" />
              </button>
            )}

            <button
              type="button"
              className="eve-todo__check"
              role="checkbox"
              aria-checked={item.done}
              aria-label={item.done ? strings.todo.markPending : strings.todo.markDone}
              title={item.done ? strings.todo.markPending : strings.todo.markDone}
              disabled={pending}
              onClick={onToggleDone}
            >
              {item.done ? <CircleCheck size={17} aria-hidden="true" /> : <Circle size={17} aria-hidden="true" />}
            </button>

            {editing ? (
              <TodoEditor
                initialText={item.text}
                ariaLabel={strings.todo.edit}
                onSubmit={onSubmitEdit}
                onCancel={onCancelEdit}
                onBlur={(text) => (text ? onSubmitEdit(text) : onCancelEdit())}
              />
            ) : (
              <span
                className="eve-todo__text"
                onClick={() => {
                  if (!pending) onStartEdit();
                }}
              >
                {parts.map((part, index) => {
                  if (part.type === 'text') return <span key={index}>{part.text}</span>;
                  if (part.type === 'missing') {
                    return (
                      <span key={index} className="eve-todo__missing" title={strings.todo.missingTarget}>
                        {part.label}
                      </span>
                    );
                  }
                  return (
                    <Link
                      key={index}
                      href={part.href}
                      className={`eve-todo__chip eve-todo__chip--${part.kind}`}
                      onClick={(event) => event.stopPropagation()}
                      onKeyDown={(event) => event.stopPropagation()}
                    >
                      {part.kind === 'page' ? <Link2 size={12} aria-hidden="true" /> : <AtSign size={12} aria-hidden="true" />}
                      {part.label}
                    </Link>
                  );
                })}
              </span>
            )}

            {item.dueDate && !editing && <span className="eve-todo__due">{formatDue(item.dueDate)}</span>}
          </div>
        </>
      )}
    </li>
  );
}
