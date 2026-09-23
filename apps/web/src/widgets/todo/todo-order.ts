import type { TodoItemDto } from '../../lib/todo-types';

export type TodoSort = 'manual' | 'pending-first';

/** Manual order as stored (position, then creation). */
export function byPosition(items: readonly TodoItemDto[]): TodoItemDto[] {
  return [...items].sort((a, b) => a.position - b.position || a.createdAt.localeCompare(b.createdAt));
}

/** What the widget lists, top to bottom, for the chosen sort and the "show completed" option. */
export function displayItems(items: readonly TodoItemDto[], sort: TodoSort, showCompleted: boolean): TodoItemDto[] {
  const ordered = byPosition(items).filter((item) => showCompleted || !item.done);
  if (sort === 'manual') return ordered;
  return [...ordered.filter((item) => !item.done), ...ordered.filter((item) => item.done)];
}

/**
 * A drag reorders only what is on screen; hidden items (completed ones, with
 * "mostrar concluidas" off) keep their slots. Returns the full order of ids.
 */
export function mergeVisibleOrder(allIds: readonly string[], visibleOrder: readonly string[]): string[] {
  const visible = new Set(visibleOrder);
  const queue = [...visibleOrder];
  return allIds.map((id) => (visible.has(id) ? queue.shift()! : id));
}

/** Items renumbered 0..n-1 in the given id order (after a drag, before the server answers). */
export function applyOrder(items: readonly TodoItemDto[], order: readonly string[]): TodoItemDto[] {
  const index = new Map(order.map((id, position) => [id, position]));
  return items.map((item) => ({ ...item, position: index.get(item.id) ?? item.position }));
}
