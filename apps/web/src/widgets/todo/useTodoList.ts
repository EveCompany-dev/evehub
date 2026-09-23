'use client';

import { strings } from '@eve/ui';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTodoEvents } from '../../components/EventStreamProvider';
import type { ResolvedTokens } from '../../lib/todo-tokens';
import type { TodoItemDto, TodoListDetail, TodoListSummary } from '../../lib/todo-types';
import { applyOrder, byPosition } from './todo-order';

export interface UseTodoList {
  lists: TodoListSummary[] | null;
  /** The list this widget shows: the chosen one if it still exists, else the user's first. */
  listId: string | null;
  listName: string | null;
  items: TodoItemDto[];
  resolved: ResolvedTokens;
  loading: boolean;
  /** When the list was last read from the server — the widget footer's "atualizado ha...". */
  loadedAt: string | null;
  error: string | null;
  dismissError: () => void;
  refresh: () => Promise<void>;
  addItem: (text: string) => Promise<void>;
  updateItem: (id: string, patch: { text?: string; done?: boolean; dueDate?: string | null }) => Promise<void>;
  deleteItem: (id: string) => Promise<TodoItemDto | null>;
  restoreItem: (item: TodoItemDto) => Promise<void>;
  reorder: (ids: string[]) => Promise<void>;
  createList: (name: string) => Promise<TodoListSummary | null>;
  renameList: (id: string, name: string) => Promise<boolean>;
  deleteList: (id: string) => Promise<boolean>;
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    cache: 'no-store',
    ...init,
    headers: init?.body ? { 'Content-Type': 'application/json', ...init.headers } : init?.headers,
  });
  const body = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok) throw new Error(body.error ?? `HTTP ${response.status}`);
  return body;
}

let tempCounter = 0;

/**
 * Data behind one Tarefas widget. Every change is optimistic — adding a task
 * has to feel instant — and reconciled with the server's answer.
 *
 * Live updates: the SSE stream pings when this user's lists change anywhere
 * (another tab, the Claude chat), and the window regaining focus refetches as
 * a fallback. A ping that lands while one of our own writes is still in
 * flight is held until it settles, so a refetch never overwrites an
 * optimistic row with a state from before the write.
 */
export function useTodoList(chosenListId: string | null): UseTodoList {
  const [lists, setLists] = useState<TodoListSummary[] | null>(null);
  const [detail, setDetail] = useState<TodoListDetail | null>(null);
  const [items, setItems] = useState<TodoItemDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadedAt, setLoadedAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const listId = lists ? (lists.find((list) => list.id === chosenListId)?.id ?? lists[0]?.id ?? null) : null;
  const listIdRef = useRef(listId);
  useEffect(() => {
    listIdRef.current = listId;
  }, [listId]);

  // The latest items, for the write callbacks: a setState updater runs lazily,
  // so it can't be used to read "the row as it was" before an optimistic change.
  const itemsRef = useRef(items);
  useEffect(() => {
    itemsRef.current = items;
  }, [items]);

  const inFlight = useRef(0);
  const refreshPending = useRef(false);
  const ensuring = useRef<Promise<string | null> | null>(null);

  const loadList = useCallback(async (id: string | null) => {
    if (!id) {
      setDetail(null);
      setItems([]);
      return;
    }
    const body = await request<TodoListDetail>(`/api/todos/lists/${encodeURIComponent(id)}`);
    // A switch to another list while this was loading makes the answer stale.
    if (listIdRef.current !== null && listIdRef.current !== id) return;
    setDetail(body);
    setItems(byPosition(body.items));
  }, []);

  const refresh = useCallback(async () => {
    try {
      const body = await request<{ lists: TodoListSummary[] }>('/api/todos/lists');
      setLists(body.lists);
      const effective = body.lists.find((list) => list.id === chosenListId)?.id ?? body.lists[0]?.id ?? null;
      listIdRef.current = effective;
      await loadList(effective);
      setLoadedAt(new Date().toISOString());
      setError(null);
    } catch {
      setError(strings.todo.loadError);
    } finally {
      setLoading(false);
    }
  }, [chosenListId, loadList]);

  useEffect(() => {
    // Mount/list-change fetch — every setState in refresh() happens after an await.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();
  }, [refresh]);

  const refreshSoon = useCallback(() => {
    if (inFlight.current > 0) {
      refreshPending.current = true;
      return;
    }
    void refresh();
  }, [refresh]);

  useTodoEvents(refreshSoon);

  useEffect(() => {
    const onFocus = () => refreshSoon();
    const onVisible = () => {
      if (document.visibilityState === 'visible') refreshSoon();
    };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [refreshSoon]);

  /** Runs one write; a refetch requested meanwhile happens once it (and any sibling) settles. */
  const track = useCallback(
    async <T,>(run: () => Promise<T>): Promise<T> => {
      inFlight.current += 1;
      try {
        return await run();
      } finally {
        inFlight.current -= 1;
        if (inFlight.current === 0 && refreshPending.current) {
          refreshPending.current = false;
          void refresh();
        }
      }
    },
    [refresh],
  );

  /** The first task of someone with no list creates "Minhas tarefas" — once, even if they type three tasks before it answers. */
  const ensureList = useCallback(async (): Promise<string | null> => {
    if (listIdRef.current) return listIdRef.current;
    ensuring.current ??= (async () => {
      try {
        const body = await request<{ list: TodoListSummary }>('/api/todos/lists', {
          method: 'POST',
          body: JSON.stringify({ name: strings.todo.defaultListName }),
        });
        setLists((current) => [...(current ?? []), body.list]);
        listIdRef.current = body.list.id;
        return body.list.id;
      } catch {
        return null;
      } finally {
        ensuring.current = null;
      }
    })();
    return ensuring.current;
  }, []);

  const addItem = useCallback(
    (text: string) =>
      track(async () => {
        const id = await ensureList();
        if (!id) {
          setError(strings.todo.saveError);
          return;
        }
        tempCounter += 1;
        const tempId = `tmp-${tempCounter}`;
        const now = new Date().toISOString();
        setItems((current) => [
          ...current,
          {
            id: tempId,
            listId: id,
            text,
            done: false,
            doneAt: null,
            position: current.reduce((max, item) => Math.max(max, item.position), -1) + 1,
            dueDate: null,
            createdAt: now,
          },
        ]);
        try {
          const body = await request<{ item: TodoItemDto }>(`/api/todos/lists/${encodeURIComponent(id)}/items`, {
            method: 'POST',
            body: JSON.stringify({ text }),
          });
          setItems((current) =>
            byPosition([...current.filter((item) => item.id !== tempId && item.id !== body.item.id), body.item]),
          );
        } catch {
          setItems((current) => current.filter((item) => item.id !== tempId));
          setError(strings.todo.saveError);
        }
      }),
    [ensureList, track],
  );

  const updateItem = useCallback<UseTodoList['updateItem']>(
    (id, patch) =>
      track(async () => {
        const previous = itemsRef.current.find((item) => item.id === id);
        setItems((current) =>
          current.map((item) => {
            if (item.id !== id) return item;
            const done = patch.done ?? item.done;
            return {
              ...item,
              ...patch,
              done,
              doneAt: done === item.done ? item.doneAt : done ? new Date().toISOString() : null,
            };
          }),
        );
        if (id.startsWith('tmp-')) return;
        try {
          const body = await request<{ item: TodoItemDto }>(`/api/todos/items/${encodeURIComponent(id)}`, {
            method: 'PATCH',
            body: JSON.stringify(patch),
          });
          setItems((current) => current.map((item) => (item.id === id ? body.item : item)));
        } catch {
          if (previous) setItems((current) => current.map((item) => (item.id === id ? previous : item)));
          setError(strings.todo.saveError);
        }
      }),
    [track],
  );

  const deleteItem = useCallback<UseTodoList['deleteItem']>(
    (id) =>
      track(async () => {
        const removed = itemsRef.current.find((item) => item.id === id);
        setItems((current) => current.filter((item) => item.id !== id));
        if (id.startsWith('tmp-')) return removed ?? null;
        try {
          const body = await request<{ item: TodoItemDto }>(`/api/todos/items/${encodeURIComponent(id)}`, { method: 'DELETE' });
          return body.item;
        } catch {
          if (removed) setItems((current) => byPosition([...current, removed]));
          setError(strings.todo.saveError);
          return null;
        }
      }),
    [track],
  );

  const restoreItem = useCallback<UseTodoList['restoreItem']>(
    (item) =>
      track(async () => {
        try {
          const body = await request<{ item: TodoItemDto }>(`/api/todos/lists/${encodeURIComponent(item.listId)}/items`, {
            method: 'POST',
            body: JSON.stringify({ text: item.text, done: item.done, dueDate: item.dueDate, position: item.position }),
          });
          if (body.item.listId !== listIdRef.current) return;
          setItems((current) =>
            byPosition([
              ...current.map((other) => (other.position >= body.item.position ? { ...other, position: other.position + 1 } : other)),
              body.item,
            ]),
          );
        } catch {
          setError(strings.todo.saveError);
        }
      }),
    [track],
  );

  const reorder = useCallback<UseTodoList['reorder']>(
    (ids) =>
      track(async () => {
        const id = listIdRef.current;
        if (!id) return;
        setItems((current) => byPosition(applyOrder(current, ids)));
        try {
          await request(`/api/todos/lists/${encodeURIComponent(id)}/order`, {
            method: 'PUT',
            body: JSON.stringify({ ids: ids.filter((itemId) => !itemId.startsWith('tmp-')) }),
          });
        } catch {
          setError(strings.todo.saveError);
          refreshPending.current = true;
        }
      }),
    [track],
  );

  const createList = useCallback<UseTodoList['createList']>(
    (name) =>
      track(async () => {
        try {
          const body = await request<{ list: TodoListSummary }>('/api/todos/lists', { method: 'POST', body: JSON.stringify({ name }) });
          setLists((current) => [...(current ?? []), body.list]);
          return body.list;
        } catch {
          setError(strings.todo.saveError);
          return null;
        }
      }),
    [track],
  );

  const renameList = useCallback<UseTodoList['renameList']>(
    (id, name) =>
      track(async () => {
        try {
          const body = await request<{ list: { id: string; name: string } }>(`/api/todos/lists/${encodeURIComponent(id)}`, {
            method: 'PATCH',
            body: JSON.stringify({ name }),
          });
          setLists((current) => current?.map((list) => (list.id === id ? { ...list, name: body.list.name } : list)) ?? null);
          setDetail((current) => (current && current.list.id === id ? { ...current, list: body.list } : current));
          return true;
        } catch {
          setError(strings.todo.saveError);
          return false;
        }
      }),
    [track],
  );

  const deleteList = useCallback<UseTodoList['deleteList']>(
    (id) =>
      track(async () => {
        try {
          await request(`/api/todos/lists/${encodeURIComponent(id)}`, { method: 'DELETE' });
          refreshPending.current = true;
          return true;
        } catch {
          setError(strings.todo.saveError);
          return false;
        }
      }),
    [track],
  );

  const listName = lists?.find((list) => list.id === listId)?.name ?? detail?.list.name ?? null;

  return {
    lists,
    listId,
    listName,
    items,
    resolved: detail?.resolved ?? {},
    loading,
    loadedAt,
    error,
    dismissError: () => setError(null),
    refresh,
    addItem,
    updateItem,
    deleteItem,
    restoreItem,
    reorder,
    createList,
    renameList,
    deleteList,
  };
}
