'use client';

import { useEffect, useRef, useState, type JSX, type RefObject } from 'react';
import { createPortal } from 'react-dom';

export interface UseFormattingToolbarResult {
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  toolbar: JSX.Element | null;
}

/**
 * A selection-triggered formatting bubble for a plain `<textarea>` — no
 * icons, text-only buttons, per the ask. Inserts Markdown syntax directly
 * into the value (bold/italic/strike/code/quote/link); pair with
 * renderRichText() (RichText.tsx) for the read-only rendering of that same
 * syntax. Rendered through a portal to document.body so it isn't clipped by
 * a modal's or grid widget's own `overflow` — the same fix NotificationBell
 * needed for its dropdown.
 *
 * Positioning is mouse-position-based (the click that finished the
 * selection), not a text-metrics measurement of the caret — textareas have
 * no API for the pixel position of a selection, and a mirror-div technique
 * to fake one is a lot of fragile code for a "close enough" bubble menu.
 * Keyboard-driven selections (Shift+Arrow) fall back to the textarea's own
 * top-left corner.
 */
export function useFormattingToolbar(value: string, onChange: (value: string) => void): UseFormattingToolbarResult {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  useEffect(() => {
    const onPointerUp = (event: MouseEvent) => {
      const textarea = textareaRef.current;
      if (!textarea || document.activeElement !== textarea || textarea.selectionStart === textarea.selectionEnd) {
        setPos(null);
        return;
      }
      setPos({ top: event.clientY - 44, left: Math.max(8, event.clientX - 60) });
    };
    const onKeyUp = () => {
      const textarea = textareaRef.current;
      if (!textarea || document.activeElement !== textarea) return;
      if (textarea.selectionStart === textarea.selectionEnd) {
        setPos(null);
        return;
      }
      const rect = textarea.getBoundingClientRect();
      setPos((current) => current ?? { top: rect.top - 4, left: rect.left + 8 });
    };
    document.addEventListener('mouseup', onPointerUp);
    document.addEventListener('keyup', onKeyUp);
    return () => {
      document.removeEventListener('mouseup', onPointerUp);
      document.removeEventListener('keyup', onKeyUp);
    };
  }, []);

  const wrap = (before: string, after: string) => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    const { selectionStart: start, selectionEnd: end } = textarea;
    if (start === end) return;

    const selected = value.slice(start, end);
    onChange(value.slice(0, start) + before + selected + after + value.slice(end));
    requestAnimationFrame(() => {
      textarea.focus();
      textarea.selectionStart = start + before.length;
      textarea.selectionEnd = start + before.length + selected.length;
    });
    setPos(null);
  };

  /** Single backtick for a one-line selection, triple-backtick fence for a selection spanning multiple lines — plain inline code can't contain newlines. */
  const wrapCode = () => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    const { selectionStart: start, selectionEnd: end } = textarea;
    if (start === end) return;

    if (value.slice(start, end).includes('\n')) {
      wrap('```\n', '\n```');
    } else {
      wrap('`', '`');
    }
  };

  /** Toggling: reapplying the same prefix on an already-quoted block removes it instead of doubling up. */
  const linePrefix = (prefix: string) => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    const { selectionStart: start, selectionEnd: end } = textarea;
    if (start === end) return;

    const lineStart = value.lastIndexOf('\n', start - 1) + 1;
    const nextBreak = value.indexOf('\n', end);
    const lineEnd = nextBreak === -1 ? value.length : nextBreak;
    const block = value.slice(lineStart, lineEnd);
    const lines = block.split('\n');
    const alreadyPrefixed = lines.every((line) => line.startsWith(prefix));
    const nextBlock = lines.map((line) => (alreadyPrefixed ? line.slice(prefix.length) : prefix + line)).join('\n');

    onChange(value.slice(0, lineStart) + nextBlock + value.slice(lineEnd));
    setPos(null);
  };

  const link = () => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    const { selectionStart: start, selectionEnd: end } = textarea;
    if (start === end) return;

    const url = window.prompt('URL do link:');
    if (!url) return;
    const selected = value.slice(start, end);
    onChange(`${value.slice(0, start)}[${selected}](${url})${value.slice(end)}`);
    setPos(null);
  };

  const toolbar = pos
    ? createPortal(
        <div
          className="eve-format-toolbar"
          style={{ top: pos.top, left: pos.left }}
          // Keeps the textarea's selection intact through the click — a
          // button's default mousedown behavior would otherwise steal focus
          // and collapse the selection before onClick ever runs.
          onMouseDown={(event) => event.preventDefault()}
        >
          <button type="button" onClick={() => wrap('**', '**')} title="Negrito">
            B
          </button>
          <button type="button" onClick={() => wrap('*', '*')} title="Itálico">
            I
          </button>
          <button type="button" onClick={() => wrap('~~', '~~')} title="Riscado">
            S
          </button>
          <button type="button" onClick={wrapCode} title="Código">
            {'</>'}
          </button>
          <button type="button" onClick={() => linePrefix('> ')} title="Citação">
            &ldquo;&rdquo;
          </button>
          <button type="button" onClick={link} title="Link">
            link
          </button>
        </div>,
        document.body,
      )
    : null;

  return { textareaRef, toolbar };
}
