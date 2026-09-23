'use client';

import { AtSign, Link2, strings } from '@eve/ui';
import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type JSX,
  type KeyboardEvent as ReactKeyboardEvent,
  type RefObject,
} from 'react';
import { createPortal } from 'react-dom';
import { currentUiZoom } from '../../lib/ui-scale';
import {
  activeTrigger,
  applyPick,
  fromEditable,
  toEditable,
  type ActiveTrigger,
  type EditableText,
} from '../../lib/todo-tokens';
import type { MentionResult } from '../../lib/todo-types';

export interface TodoEditorProps {
  /** Stored text (with tokens) to start from. */
  initialText?: string;
  /** Plain characters to start with — the key that was typed to open the editor. */
  initialTyped?: string;
  placeholder?: string;
  /** Enter. Receives the stored text (tokens restored). The editor clears itself when `keepOpen`. */
  onSubmit: (text: string) => void;
  onCancel: () => void;
  /** Leaving the field: save when there is text (editing), or just close. */
  onBlur?: (text: string) => void;
  /** Composer mode: after Enter the field empties and stays focused for the next task. */
  keepOpen?: boolean;
  ariaLabel: string;
}

const SEARCH_DEBOUNCE_MS = 120;

/**
 * The single-line field behind "Nova tarefa" and in-place editing.
 *
 * "@" opens a picker of jobs, clients, projects, tables and people; "/" one of
 * the app's pages. Picking inserts a mention that shows as "@Label" while
 * typing and is stored as a token (see lib/todo-tokens.ts). Same trigger rule
 * as the team chat's @mentions — only at the start or after a space.
 */
export function TodoEditor({
  initialText = '',
  initialTyped = '',
  placeholder,
  onSubmit,
  onCancel,
  onBlur,
  keepOpen = false,
  ariaLabel,
}: TodoEditorProps): JSX.Element {
  const [editable, setEditable] = useState<EditableText>(() => {
    const start = toEditable(initialText);
    return { ...start, value: start.value + initialTyped };
  });
  const [trigger, setTrigger] = useState<ActiveTrigger | null>(null);
  const [results, setResults] = useState<MentionResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const pickerId = useId();
  // Set once Escape or Enter has closed the editor: the blur that follows as it
  // unmounts must not save again (or, after Escape, at all).
  const finished = useRef(false);

  useLayoutEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    input.focus();
    const end = input.value.length;
    input.setSelectionRange(end, end);
  }, []);

  // Look up whatever follows the "@" or "/" (debounced; the latest query wins).
  const query = trigger ? `${trigger.trigger}${trigger.query}` : null;
  useEffect(() => {
    if (query === null) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      setSearching(true);
      const params = new URLSearchParams({ trigger: query[0]!, q: query.slice(1) });
      fetch(`/api/todos/mentions?${params.toString()}`, { cache: 'no-store', signal: controller.signal })
        .then((response) => (response.ok ? response.json() : { results: [] }))
        .then((body: { results?: MentionResult[] }) => {
          setResults(body.results ?? []);
          setHighlight(0);
        })
        .catch(() => undefined)
        .finally(() => {
          if (!controller.signal.aborted) setSearching(false);
        });
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query]);

  const updateTrigger = (value: string, caret: number) => {
    const next = activeTrigger(value, caret);
    setTrigger(next);
    if (!next) setResults([]);
  };

  const stored = () => fromEditable(editable.value, editable.mentions).trim();

  const pick = (result: MentionResult) => {
    const input = inputRef.current;
    if (!trigger || !input) return;
    const caret = input.selectionStart ?? editable.value.length;
    const next = applyPick(editable, trigger, caret, result);
    setEditable({ value: next.value, mentions: next.mentions });
    setTrigger(null);
    setResults([]);
    requestAnimationFrame(() => {
      input.focus();
      input.setSelectionRange(next.caret, next.caret);
    });
  };

  const pickerOpen = trigger !== null;

  const onKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    // The row and the widget have their own Enter/Delete/Arrow handling; none of it applies inside the field.
    event.stopPropagation();

    if (pickerOpen && results.length > 0) {
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setHighlight((current) => (current + 1) % results.length);
        return;
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        setHighlight((current) => (current - 1 + results.length) % results.length);
        return;
      }
      if (event.key === 'Enter' || event.key === 'Tab') {
        event.preventDefault();
        const result = results[Math.min(highlight, results.length - 1)];
        if (result) pick(result);
        return;
      }
    }

    if (event.key === 'Escape') {
      event.preventDefault();
      if (pickerOpen) {
        setTrigger(null);
        setResults([]);
        return;
      }
      finished.current = true;
      onCancel();
      return;
    }

    if (event.key === 'Enter') {
      event.preventDefault();
      if (event.nativeEvent.isComposing) return;
      const text = stored();
      if (!text && keepOpen) return;
      if (!keepOpen) finished.current = true;
      onSubmit(text);
      if (keepOpen) {
        setEditable({ value: '', mentions: [] });
        setTrigger(null);
        setResults([]);
      }
    }
  };

  return (
    <div className="eve-todo__editor">
      <input
        ref={inputRef}
        className="eve-todo__input eve-no-drag"
        value={editable.value}
        placeholder={placeholder}
        aria-label={ariaLabel}
        maxLength={1800}
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={pickerOpen}
        aria-controls={pickerOpen ? pickerId : undefined}
        aria-activedescendant={pickerOpen && results.length > 0 ? `${pickerId}-${highlight}` : undefined}
        onChange={(event) => {
          setEditable((current) => ({ ...current, value: event.target.value }));
          updateTrigger(event.target.value, event.target.selectionStart ?? event.target.value.length);
        }}
        onSelect={(event) => {
          const input = event.currentTarget;
          updateTrigger(input.value, input.selectionStart ?? input.value.length);
        }}
        onKeyDown={onKeyDown}
        onBlur={() => {
          setTrigger(null);
          if (finished.current) return;
          onBlur?.(stored());
        }}
      />
      {pickerOpen && (
        <MentionPicker
          id={pickerId}
          anchor={inputRef}
          trigger={trigger.trigger}
          results={results}
          searching={searching}
          highlight={highlight}
          onHighlight={setHighlight}
          onPick={pick}
        />
      )}
    </div>
  );
}

interface MentionPickerProps {
  id: string;
  anchor: RefObject<HTMLInputElement | null>;
  trigger: '@' | '/';
  results: MentionResult[];
  searching: boolean;
  highlight: number;
  onHighlight: (index: number) => void;
  onPick: (result: MentionResult) => void;
}

const PICKER_WIDTH = 280;
const PICKER_MAX_HEIGHT = 260;

/** Fixed-position list on <body>: the widget body scrolls and clips, and grid tiles are transformed. */
function MentionPicker({
  id,
  anchor,
  trigger,
  results,
  searching,
  highlight,
  onHighlight,
  onPick,
}: MentionPickerProps): JSX.Element | null {
  const [rect, setRect] = useState<{ left: number; top: number; bottom: number } | null>(null);

  useLayoutEffect(() => {
    const measure = () => {
      const box = anchor.current?.getBoundingClientRect();
      if (!box) return;
      const zoom = currentUiZoom();
      setRect({ left: box.left / zoom, top: box.top / zoom, bottom: box.bottom / zoom });
    };
    measure();
    window.addEventListener('resize', measure);
    document.addEventListener('scroll', measure, true);
    return () => {
      window.removeEventListener('resize', measure);
      document.removeEventListener('scroll', measure, true);
    };
  }, [anchor]);

  if (!rect || typeof document === 'undefined') return null;

  const viewportHeight = window.innerHeight / currentUiZoom();
  const viewportWidth = window.innerWidth / currentUiZoom();
  const below = viewportHeight - rect.bottom;
  const openUp = below < PICKER_MAX_HEIGHT + 12 && rect.top > below;
  const style = {
    left: Math.max(8, Math.min(rect.left, viewportWidth - PICKER_WIDTH - 8)),
    ...(openUp ? { bottom: viewportHeight - rect.top + 4 } : { top: rect.bottom + 4 }),
  };

  const kindLabel = strings.todo.mentionKinds;

  return createPortal(
    <ul id={id} className="eve-todo__picker" role="listbox" style={style} aria-label={trigger === '@' ? 'Mencionar' : 'Linkar página'}>
      {results.length === 0 && (
        <li className="eve-todo__picker-empty" role="presentation">
          {searching ? strings.todo.mentionLoading : strings.todo.mentionEmpty}
        </li>
      )}
      {results.map((result, index) => (
        <li
          key={`${result.kind}:${result.id}`}
          id={`${id}-${index}`}
          role="option"
          aria-selected={index === highlight}
          className={index === highlight ? 'eve-todo__picker-item is-active' : 'eve-todo__picker-item'}
          onMouseEnter={() => onHighlight(index)}
          // Keeps focus (and the caret) in the input, so picking never blurs — and never saves — the task.
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => onPick(result)}
        >
          <span className="eve-todo__picker-icon" aria-hidden="true">
            {result.kind === 'page' ? <Link2 size={14} /> : <AtSign size={14} />}
          </span>
          <span className="eve-todo__picker-label">{result.label}</span>
          <span className="eve-todo__picker-kind">{result.hint ?? kindLabel[result.kind]}</span>
        </li>
      ))}
    </ul>,
    document.body,
  );
}
