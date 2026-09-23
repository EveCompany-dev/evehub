import type { ResolvedTokens, TokenKind } from './todo-tokens';

/**
 * The /api/todos payloads, shared by the server (lib/todos.ts) and the widget.
 * Types only — nothing here pulls Prisma into the browser bundle.
 */

export interface TodoListSummary {
  id: string;
  name: string;
  position: number;
  pendingCount: number;
  doneCount: number;
}

export interface TodoItemDto {
  id: string;
  listId: string;
  text: string;
  done: boolean;
  doneAt: string | null;
  position: number;
  dueDate: string | null;
  createdAt: string;
}

export interface TodoListDetail {
  list: { id: string; name: string };
  items: TodoItemDto[];
  resolved: ResolvedTokens;
}

export interface MentionResult {
  kind: TokenKind;
  id: string;
  label: string;
  hint?: string;
}
