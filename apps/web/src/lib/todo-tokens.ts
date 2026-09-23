/**
 * Mentions and page links inside a to-do's text.
 *
 * They are stored in the text itself, Markdown-link style, so a task stays one
 * plain string (easy for the Claude chat to read and write) and still knows
 * exactly what it points at:
 *
 *   @[Campanha de setembro](job:ckx123)   a job, client, project, table or person
 *   /[Jobs](page:/jobs)                   a page of the app
 *
 * The widget renders each token as a clickable chip; a token whose target was
 * deleted (or that the user can no longer see) falls back to its label as
 * plain text. While editing, tokens show as "@Label" and are turned back into
 * tokens on save (toEditable / fromEditable).
 *
 * Pure functions only: this module is shared by the widget, the API routes
 * and the tests.
 */

export const MENTION_KINDS = ['job', 'client', 'project', 'table', 'person'] as const;
export type MentionKind = (typeof MENTION_KINDS)[number];
export type TokenKind = MentionKind | 'page';

export interface TodoToken {
  kind: TokenKind;
  id: string;
  label: string;
}

export type TodoSegment = { type: 'text'; text: string } | { type: 'token'; token: TodoToken; raw: string };

const TOKEN_PATTERN = /([@/])\[([^\]\n]{1,120})\]\((job|client|project|table|person|page):([^)\s]{1,200})\)/g;

const MAX_LABEL = 80;

/** Labels live inside [...] — brackets, parentheses and line breaks would break the token. */
export function sanitizeLabel(label: string): string {
  return label.replace(/[[\]()\n\r]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, MAX_LABEL);
}

export function tokenPrefix(kind: TokenKind): '@' | '/' {
  return kind === 'page' ? '/' : '@';
}

export function formatToken(kind: TokenKind, id: string, label: string): string {
  const clean = sanitizeLabel(label) || id;
  return `${tokenPrefix(kind)}[${clean}](${kind}:${id})`;
}

export function tokenKey(kind: TokenKind, id: string): string {
  return `${kind}:${id}`;
}

/** Splits a to-do's text into plain runs and tokens, in order. A token with the wrong prefix stays plain text. */
export function parseTodoText(text: string): TodoSegment[] {
  const segments: TodoSegment[] = [];
  let last = 0;

  for (const match of text.matchAll(TOKEN_PATTERN)) {
    const [raw, prefix, label, kind, id] = match as unknown as [string, '@' | '/', string, TokenKind, string];
    if (prefix !== tokenPrefix(kind)) continue;
    const index = match.index ?? 0;
    if (index > last) segments.push({ type: 'text', text: text.slice(last, index) });
    segments.push({ type: 'token', token: { kind, id, label }, raw });
    last = index + raw.length;
  }

  if (last < text.length) segments.push({ type: 'text', text: text.slice(last) });
  return segments;
}

export function extractTokens(text: string): TodoToken[] {
  return parseTodoText(text).flatMap((segment) => (segment.type === 'token' ? [segment.token] : []));
}

/** The text a person reads: every token replaced by its label (for the chat, confirmations, the undo banner). */
export function plainTodoText(text: string): string {
  return parseTodoText(text)
    .map((segment) => (segment.type === 'text' ? segment.text : segment.token.label))
    .join('');
}

/** Where a chip navigates. Mirrors the deep links used elsewhere in the app. */
export function tokenHref(kind: TokenKind, id: string): string | null {
  const safe = encodeURIComponent(id);
  switch (kind) {
    case 'job':
      return `/jobs?job=${safe}`;
    case 'client':
      return `/clients/${safe}`;
    case 'project':
      return `/projects/${safe}`;
    case 'table':
      return `/tables?table=${safe}`;
    case 'person':
      return '/team';
    case 'page':
      // Only app-relative paths: never "//evil.example" or "javascript:".
      return /^\/(?!\/)[\w\-/?=&%.]*$/.test(id) ? id : null;
  }
}

/**
 * What the server knows about each token: its current label, or null when the
 * target is gone or not visible to this user. A key missing from the map is a
 * token the server has not checked yet (just typed) and renders as a chip.
 */
export type ResolvedTokens = Record<string, string | null>;

export type TodoRenderPart =
  | { type: 'text'; text: string }
  | { type: 'chip'; kind: TokenKind; label: string; href: string }
  | { type: 'missing'; kind: TokenKind; label: string };

export function todoRenderParts(text: string, resolved: ResolvedTokens | null): TodoRenderPart[] {
  return parseTodoText(text).map((segment): TodoRenderPart => {
    if (segment.type === 'text') return segment;
    const { kind, id, label } = segment.token;
    const known = resolved?.[tokenKey(kind, id)];
    const href = tokenHref(kind, id);
    if (known === null || href === null) return { type: 'missing', kind, label };
    return { type: 'chip', kind, label: known ?? label, href };
  });
}

// ---------------------------------------------------------------------------
// Editing: tokens as "@Label" in a plain input
// ---------------------------------------------------------------------------

export interface EditableMention {
  /** What the input shows, e.g. "@Campanha de setembro". */
  display: string;
  /** What gets stored. */
  token: string;
}

export interface EditableText {
  value: string;
  mentions: EditableMention[];
}

export function toEditable(text: string): EditableText {
  const mentions: EditableMention[] = [];
  const value = parseTodoText(text)
    .map((segment) => {
      if (segment.type === 'text') return segment.text;
      const display = `${tokenPrefix(segment.token.kind)}${segment.token.label}`;
      mentions.push({ display, token: segment.raw });
      return display;
    })
    .join('');
  return { value, mentions };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Turns what the input shows back into the stored text. Each "@Label" still
 * present becomes its token again; one the user edited or deleted simply stays
 * whatever text is left.
 */
export function fromEditable(value: string, mentions: EditableMention[]): string {
  if (mentions.length === 0) return value;

  // Longest first, so "@Ana Paula" wins over "@Ana" at the same spot.
  const displays = [...new Set(mentions.map((mention) => mention.display))].sort((a, b) => b.length - a.length);
  const queue = new Map<string, string[]>();
  for (const mention of mentions) queue.set(mention.display, [...(queue.get(mention.display) ?? []), mention.token]);

  const pattern = new RegExp(displays.map(escapeRegExp).join('|'), 'g');
  return value.replace(pattern, (match) => {
    const tokens = queue.get(match);
    return tokens && tokens.length > 0 ? tokens.shift()! : match;
  });
}

export interface ActiveTrigger {
  trigger: '@' | '/';
  query: string;
  /** Index of the trigger character in the value. */
  start: number;
}

/**
 * The "@..." or "/..." being typed right before the caret, if any. Only at the
 * start or after whitespace, so an e-mail address, a URL or a date like 12/10
 * never opens a picker.
 */
export function activeTrigger(value: string, caret: number): ActiveTrigger | null {
  const before = value.slice(0, caret);
  const match = before.match(/(?:^|\s)([@/])([^\s@/]{0,40})$/);
  if (!match) return null;
  const query = match[2] ?? '';
  return { trigger: match[1] as '@' | '/', query, start: caret - query.length - 1 };
}

export interface PickTarget {
  kind: TokenKind;
  id: string;
  label: string;
}

/** Replaces the "@query" being typed with the picked mention (plus a space) and records it. */
export function applyPick(
  current: EditableText,
  trigger: ActiveTrigger,
  caret: number,
  pick: PickTarget,
): EditableText & { caret: number } {
  const label = sanitizeLabel(pick.label) || pick.id;
  const display = `${tokenPrefix(pick.kind)}${label}`;
  const value = `${current.value.slice(0, trigger.start)}${display} ${current.value.slice(caret)}`;
  return {
    value,
    mentions: [...current.mentions, { display, token: formatToken(pick.kind, pick.id, label) }],
    caret: trigger.start + display.length + 1,
  };
}
