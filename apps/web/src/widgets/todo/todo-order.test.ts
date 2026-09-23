import { describe, expect, it } from 'vitest';
import type { TodoItemDto } from '../../lib/todo-types';
import { applyOrder, displayItems, mergeVisibleOrder } from './todo-order';

const item = (id: string, position: number, done = false): TodoItemDto => ({
  id,
  listId: 'l1',
  text: id,
  done,
  doneAt: done ? '2026-09-22T12:00:00.000Z' : null,
  position,
  dueDate: null,
  createdAt: '2026-09-22T10:00:00.000Z',
});

describe('to-do ordering', () => {
  const items = [item('c', 2), item('a', 0, true), item('b', 1), item('d', 3, true)];

  it('lists in manual order, optionally hiding completed ones', () => {
    expect(displayItems(items, 'manual', true).map((row) => row.id)).toEqual(['a', 'b', 'c', 'd']);
    expect(displayItems(items, 'manual', false).map((row) => row.id)).toEqual(['b', 'c']);
  });

  it('puts pending tasks first, each group still in manual order', () => {
    expect(displayItems(items, 'pending-first', true).map((row) => row.id)).toEqual(['b', 'c', 'a', 'd']);
  });

  it('keeps hidden tasks in their slots when the visible ones are dragged', () => {
    // a and d are completed and hidden; the user swaps b and c.
    expect(mergeVisibleOrder(['a', 'b', 'c', 'd'], ['c', 'b'])).toEqual(['a', 'c', 'b', 'd']);
  });

  it('renumbers positions to match a new order', () => {
    const next = applyOrder(items, ['d', 'c', 'b', 'a']);
    expect(Object.fromEntries(next.map((row) => [row.id, row.position]))).toEqual({ d: 0, c: 1, b: 2, a: 3 });
  });
});
