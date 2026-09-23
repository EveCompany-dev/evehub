'use client';

import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type Modifier,
} from '@dnd-kit/core';
import { arrayMove, SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { readViewOption, withViewOption } from '@eve/core/dashboard';
import { Plus, strings, UndoBanner, WidgetShell } from '@eve/ui';
import { useCallback, useEffect, useRef, useState, type JSX, type MouseEvent as ReactMouseEvent } from 'react';
import { createPortal } from 'react-dom';
import { useContextMenu } from '../components/ContextMenu';
import { plainTodoText, todoRenderParts } from '../lib/todo-tokens';
import type { TodoItemDto } from '../lib/todo-types';
import { currentUiZoom } from '../lib/ui-scale';
import type { WidgetProps } from './types';
import { TodoEditor } from './todo/TodoEditor';
import { byPosition, displayItems, mergeVisibleOrder, type TodoSort } from './todo/todo-order';
import { TodoRow } from './todo/TodoRow';
import { TodoSettings } from './todo/TodoSettings';
import { useTodoList } from './todo/useTodoList';

/** Rows only move up and down; and the site-wide zoom must not make them drift from the cursor (see JobsBoard). */
const verticalZoomAware: Modifier = ({ transform }) => {
  const zoom = currentUiZoom();
  return { ...transform, x: 0, y: zoom === 1 ? transform.y : transform.y / zoom };
};

const NEW_LIST_OPTION = '__new__';

function isTypingTarget(element: Element | null): boolean {
  if (!(element instanceof HTMLElement)) return false;
  return element.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(element.tagName);
}

/**
 * "Tarefas": a personal to-do list built for speed.
 *
 * - Adding: the "+ Nova tarefa" row is always there; typing anywhere while the
 *   widget is hovered or focused (and no field is) starts a task with that
 *   letter; Enter saves and opens the next empty row; Escape cancels.
 * - Editing: click a task's text.
 * - Removing, always with a confirmation inside the row: swipe left (touch),
 *   right-click → Excluir, or select the row and press Delete. Undo in a banner.
 * - "@" mentions jobs/clients/projects/tables/people, "/" links a page; both
 *   render as chips that navigate.
 *
 * Lists are the signed-in user's own (see lib/todos.ts); which list this
 * widget shows, and how, lives in its viewConfig.options.
 */
export function TodoWidget({ title, viewConfig, onViewConfigChange }: WidgetProps): JSX.Element {
  const storedListId = readViewOption<string | null>(viewConfig, 'listId', null);
  const chosenListId = typeof storedListId === 'string' ? storedListId : null;
  const showCompleted = readViewOption(viewConfig, 'showCompleted', true);
  const sort: TodoSort = readViewOption<string>(viewConfig, 'sort', 'manual') === 'pending-first' ? 'pending-first' : 'manual';

  const todo = useTodoList(chosenListId);
  const menu = useContextMenu();

  const [composer, setComposer] = useState<{ key: number; typed: string } | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [lastDeleted, setLastDeleted] = useState<TodoItemDto | null>(null);
  const [creatingList, setCreatingList] = useState(false);
  const [newListName, setNewListName] = useState('');

  const rootRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLDivElement>(null);
  const rowRefs = useRef(new Map<string, HTMLLIElement>());
  const hovered = useRef(false);
  const editingRef = useRef<string | null>(null);
  const confirmingRef = useRef<string | null>(null);
  useEffect(() => {
    editingRef.current = editingId;
    confirmingRef.current = confirmingId;
  }, [editingId, confirmingId]);

  const setOption = (key: string, value: string | boolean | null) => onViewConfigChange(withViewOption(viewConfig, key, value));

  const visible = displayItems(todo.items, sort, showCompleted);
  const pendingCount = todo.items.filter((item) => !item.done).length;
  const hiddenDone = showCompleted ? 0 : todo.items.length - pendingCount;

  const focusRow = (id: string | null) => {
    if (!id) return;
    requestAnimationFrame(() => rowRefs.current.get(id)?.focus());
  };

  const openComposer = useCallback((typed = '') => {
    setComposer((current) => ({ key: (current?.key ?? 0) + 1, typed }));
    setEditingId(null);
    setConfirmingId(null);
  }, []);

  // Typing starts a task: any printable key while the widget is hovered or
  // holds focus, as long as no field has focus and nothing is open on top.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing || event.ctrlKey || event.metaKey || event.altKey) return;
      if (event.key.length !== 1 || event.key === ' ') return;
      const root = rootRef.current;
      if (!root) return;
      const active = document.activeElement;
      if (!hovered.current && !(active && root.contains(active))) return;
      if (isTypingTarget(active)) return;
      if (confirmingRef.current || editingRef.current) return;
      if (document.querySelector('.eve-backdrop, .eve-modal-backdrop, .eve-palette-backdrop, .eve-contextmenu')) return;
      event.preventDefault();
      openComposer(event.key);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [openComposer]);

  const addFromComposer = (text: string) => {
    void todo.addItem(text);
    requestAnimationFrame(() => composerRef.current?.scrollIntoView({ block: 'nearest' }));
  };

  const startEdit = (id: string) => {
    setConfirmingId(null);
    setComposer(null);
    setSelectedId(id);
    setEditingId(id);
  };

  const finishEdit = (item: TodoItemDto, text: string | null) => {
    if (editingRef.current !== item.id) return;
    editingRef.current = null;
    setEditingId(null);
    if (text === null) {
      focusRow(item.id);
      return;
    }
    if (!text) {
      // Emptying a task is a delete — which, like every delete, asks first.
      setConfirmingId(item.id);
      return;
    }
    if (text !== item.text) void todo.updateItem(item.id, { text });
    focusRow(item.id);
  };

  const requestDelete = (id: string) => {
    setEditingId(null);
    setSelectedId(id);
    setConfirmingId(id);
  };

  const cancelDelete = (id: string) => {
    setConfirmingId(null);
    focusRow(id);
  };

  const confirmDelete = async (id: string) => {
    const index = visible.findIndex((item) => item.id === id);
    const next = visible[index + 1] ?? visible[index - 1] ?? null;
    setConfirmingId(null);
    setSelectedId(next?.id ?? null);
    focusRow(next?.id ?? null);
    const removed = await todo.deleteItem(id);
    if (removed && !removed.id.startsWith('tmp-')) setLastDeleted(removed);
  };

  const undoDelete = () => {
    if (!lastDeleted) return;
    const item = lastDeleted;
    setLastDeleted(null);
    void todo.restoreItem(item);
  };

  const toggleDone = (item: TodoItemDto) => void todo.updateItem(item.id, { done: !item.done });

  const moveBy = (item: TodoItemDto, delta: -1 | 1) => {
    const ids = visible.map((row) => row.id);
    const from = ids.indexOf(item.id);
    const to = from + delta;
    if (from < 0 || to < 0 || to >= ids.length) return;
    void todo.reorder(mergeVisibleOrder(byPosition(todo.items).map((row) => row.id), arrayMove(ids, from, to)));
    focusRow(item.id);
  };

  const navigate = (from: string, to: -1 | 1 | 'first' | 'last') => {
    const index = visible.findIndex((item) => item.id === from);
    const target =
      to === 'first' ? visible[0] : to === 'last' ? visible[visible.length - 1] : visible[Math.min(Math.max(index + to, 0), visible.length - 1)];
    if (!target) return;
    setSelectedId(target.id);
    focusRow(target.id);
  };

  const openRowMenu = (event: ReactMouseEvent, item: TodoItemDto) => {
    // useContextMenu().open stops propagation, so the grid's own
    // lock/remove menu for the widget never opens on top of this one.
    setSelectedId(item.id);
    const index = visible.findIndex((row) => row.id === item.id);
    menu.open(event, [
      { label: strings.todo.edit, onSelect: () => startEdit(item.id), hint: 'Enter' },
      { label: item.done ? strings.todo.markPending : strings.todo.markDone, onSelect: () => toggleDone(item), hint: 'Espaço' },
      ...(sort === 'manual'
        ? [
            { label: strings.todo.moveUp, disabled: index <= 0, onSelect: () => moveBy(item, -1) },
            { label: strings.todo.moveDown, disabled: index >= visible.length - 1, onSelect: () => moveBy(item, 1) },
          ]
        : []),
      { label: '', separator: true },
      { label: strings.todo.deleteYes, danger: true, hint: 'Del', onSelect: () => requestDelete(item.id) },
    ]);
  };

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    const ids = visible.map((item) => item.id);
    const from = ids.indexOf(String(active.id));
    const to = ids.indexOf(String(over.id));
    if (from < 0 || to < 0) return;
    void todo.reorder(mergeVisibleOrder(byPosition(todo.items).map((item) => item.id), arrayMove(ids, from, to)));
  };

  const pickList = (id: string) => {
    setOption('listId', id);
    setSelectedId(null);
    setEditingId(null);
    setConfirmingId(null);
    setLastDeleted(null);
  };

  const createListInline = async () => {
    const name = newListName.trim();
    if (!name) {
      setCreatingList(false);
      return;
    }
    const list = await todo.createList(name);
    setCreatingList(false);
    setNewListName('');
    if (list) pickList(list.id);
  };

  const status = todo.error && !todo.lists ? 'error' : todo.loading ? 'syncing' : 'ok';
  const menuNode = menu.render();
  const footer = [strings.todo.pending(pendingCount), hiddenDone > 0 ? strings.todo.hiddenDone(hiddenDone) : null]
    .filter(Boolean)
    .join(' · ');

  return (
    <WidgetShell
      title={title}
      status={status}
      statusMessage={todo.error}
      lastSyncedAt={todo.loadedAt}
      footerExtra={todo.lists ? footer : null}
      onSyncNow={todo.refresh}
      onUndoLast={lastDeleted ? undoDelete : null}
      settings={{
        geral: (
          <TodoSettings
            lists={todo.lists}
            listId={todo.listId}
            onPickList={pickList}
            onCreateList={todo.createList}
            onRenameList={todo.renameList}
            onDeleteList={todo.deleteList}
            showCompleted={showCompleted}
            onShowCompletedChange={(next) => setOption('showCompleted', next)}
            sort={sort}
            onSortChange={(next) => setOption('sort', next)}
          />
        ),
      }}
    >
      <div
        ref={rootRef}
        className="eve-todo eve-no-drag"
        onMouseEnter={() => {
          hovered.current = true;
        }}
        onMouseLeave={() => {
          hovered.current = false;
        }}
      >
        {todo.lists && todo.lists.length > 1 && (
          <div className="eve-todo__listbar">
            {creatingList ? (
              <input
                className="eve-todo__input"
                autoFocus
                placeholder={strings.todo.newListPlaceholder}
                value={newListName}
                maxLength={80}
                aria-label={strings.todo.newList}
                onChange={(event) => setNewListName(event.target.value)}
                onKeyDown={(event) => {
                  event.stopPropagation();
                  if (event.key === 'Enter') void createListInline();
                  if (event.key === 'Escape') {
                    setCreatingList(false);
                    setNewListName('');
                  }
                }}
                onBlur={() => void createListInline()}
              />
            ) : (
              <select
                className="eve-todo__listselect"
                aria-label={strings.todo.listPicker}
                value={todo.listId ?? ''}
                onChange={(event) => {
                  if (event.target.value === NEW_LIST_OPTION) setCreatingList(true);
                  else pickList(event.target.value);
                }}
              >
                {todo.lists.map((list) => (
                  <option key={list.id} value={list.id}>
                    {list.name}
                  </option>
                ))}
                <option value={NEW_LIST_OPTION}>+ {strings.todo.newList}</option>
              </select>
            )}
          </div>
        )}

        {todo.error && todo.lists && (
          <div className="eve-alert eve-alert--error">
            <span>{todo.error}</span>
            <button type="button" className="eve-btn" onClick={todo.dismissError}>
              {strings.edit.dismiss}
            </button>
          </div>
        )}
        {todo.error && !todo.lists && (
          <div className="eve-alert eve-alert--error">
            <span>{todo.error}</span>
            <button type="button" className="eve-btn" onClick={() => void todo.refresh()}>
              {strings.widget.retry}
            </button>
          </div>
        )}

        {lastDeleted && (
          <UndoBanner
            editId={lastDeleted.id}
            message={strings.todo.deleted(plainTodoText(lastDeleted.text))}
            onUndo={undoDelete}
            autoHideMs={8_000}
          />
        )}

        {todo.loading && !todo.lists ? (
          <p className="eve-dim">carregando...</p>
        ) : (
          <>
            {visible.length === 0 && (
              <p className="eve-todo__empty eve-dim">{todo.items.length > 0 ? strings.todo.allDone : strings.todo.empty}</p>
            )}

            <DndContext sensors={sensors} collisionDetection={closestCenter} modifiers={[verticalZoomAware]} onDragEnd={onDragEnd}>
              <SortableContext items={visible.map((item) => item.id)} strategy={verticalListSortingStrategy}>
                <ul className="eve-todo__list" aria-label={strings.todo.listLabel}>
                  {visible.map((item, index) => (
                    <TodoRow
                      key={item.id}
                      item={item}
                      parts={todoRenderParts(item.text, todo.resolved)}
                      selected={selectedId === item.id || (selectedId === null && index === 0)}
                      editing={editingId === item.id}
                      confirming={confirmingId === item.id}
                      sortable={sort === 'manual'}
                      onSelect={() => {
                        setSelectedId(item.id);
                        focusRow(item.id);
                      }}
                      onToggleDone={() => toggleDone(item)}
                      onStartEdit={() => startEdit(item.id)}
                      onSubmitEdit={(text) => finishEdit(item, text)}
                      onCancelEdit={() => finishEdit(item, null)}
                      onRequestDelete={() => requestDelete(item.id)}
                      onConfirmDelete={() => void confirmDelete(item.id)}
                      onCancelDelete={() => cancelDelete(item.id)}
                      onContextMenu={(event) => openRowMenu(event, item)}
                      onNavigate={(to) => navigate(item.id, to)}
                      registerRef={(node) => {
                        if (node) rowRefs.current.set(item.id, node);
                        else rowRefs.current.delete(item.id);
                      }}
                    />
                  ))}
                </ul>
              </SortableContext>
            </DndContext>

            {composer ? (
              <div ref={composerRef} className="eve-todo__composer">
                <Plus size={16} aria-hidden="true" className="eve-todo__composer-icon" />
                <TodoEditor
                  key={composer.key}
                  initialTyped={composer.typed}
                  placeholder={strings.todo.inputPlaceholder}
                  ariaLabel={strings.todo.newTask}
                  keepOpen
                  onSubmit={addFromComposer}
                  onCancel={() => setComposer(null)}
                  onBlur={(text) => {
                    if (text) void todo.addItem(text);
                    setComposer(null);
                  }}
                />
              </div>
            ) : (
              <button type="button" className="eve-todo__add" onClick={() => openComposer()}>
                <Plus size={16} aria-hidden="true" />
                {strings.todo.newTask}
              </button>
            )}
          </>
        )}
        {/* On <body>: grid tiles are CSS-transformed, which would anchor a fixed menu to the tile. */}
        {menuNode && createPortal(menuNode, document.body)}
      </div>
    </WidgetShell>
  );
}
