'use client';

import { strings } from '@eve/ui';
import { useCallback, useEffect, useMemo, useRef, useState, type JSX } from 'react';
import { rank } from '../lib/command-search';

export interface PaletteCommand {
  id: string;
  label: string;
  /** Right-hand detail: a shortcut, a path, the tela a module belongs to. */
  hint?: string;
  section: string;
  /** Synonyms, so a setting is findable by the word the user would type. */
  keywords?: string[];
  run: () => void | Promise<void>;
}

const RECENTS_KEY = 'eve.palette.recents';
const RECENTS_MAX = 8;

function readRecents(): string[] {
  try {
    const raw = window.localStorage.getItem(RECENTS_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((entry): entry is string => typeof entry === 'string') : [];
  } catch {
    // A private window, cleared site data, or storage blocked outright: the
    // palette works fine without any history.
    return [];
  }
}

/**
 * Ctrl+K: one index over everything.
 *
 * Pages, every individual setting (deep-linked to the exact control),
 * connectors to add, and — on the board — every module and every tela, which
 * jump the viewport to where they actually are. The caller assembles the
 * list; this component only ranks, groups and runs it.
 */
export function CommandPalette({ commands }: { commands: PaletteCommand[] }): JSX.Element | null {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [highlight, setHighlight] = useState(0);
  const [recents, setRecents] = useState<string[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setOpen((value) => !value);
        setQuery('');
        setHighlight(0);
        setRecents(readRecents());
      }
      if (event.key === 'Escape') setOpen(false);
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  const filtered = useMemo(
    () => rank(query, commands, { recent: recents, idOf: (command) => command.id }),
    [commands, query, recents],
  );

  // Keep the highlight inside the list as it shrinks under the query.
  const active = Math.min(highlight, Math.max(filtered.length - 1, 0));

  useEffect(() => {
    listRef.current?.querySelector('.is-active')?.scrollIntoView({ block: 'nearest' });
  }, [active, query]);

  const run = useCallback((command: PaletteCommand) => {
    setOpen(false);

    try {
      const next = [command.id, ...readRecents().filter((id) => id !== command.id)].slice(0, RECENTS_MAX);
      window.localStorage.setItem(RECENTS_KEY, JSON.stringify(next));
    } catch {
      // Not worth failing the command over.
    }

    void command.run();
  }, []);

  if (!open) return null;

  const sections = [...new Set(filtered.map((command) => command.section))];

  return (
    <div className="eve-palette-backdrop" role="presentation" onClick={() => setOpen(false)}>
      <div
        className="eve-palette"
        role="dialog"
        aria-modal="true"
        aria-label={strings.palette.placeholder}
        onClick={(event) => event.stopPropagation()}
      >
        <input
          ref={inputRef}
          className="eve-palette__input"
          placeholder={strings.palette.placeholder}
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setHighlight(0);
          }}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown') {
              event.preventDefault();
              setHighlight(Math.min(active + 1, filtered.length - 1));
            }
            if (event.key === 'ArrowUp') {
              event.preventDefault();
              setHighlight(Math.max(active - 1, 0));
            }
            if (event.key === 'Home') setHighlight(0);
            if (event.key === 'End') setHighlight(filtered.length - 1);
            if (event.key === 'Enter') {
              const command = filtered[active];
              if (command) run(command);
            }
          }}
        />

        <div className="eve-palette__list" ref={listRef}>
          {filtered.length === 0 && <p className="eve-palette__empty">{strings.palette.empty}</p>}

          {sections.map((section) => (
            <div key={section}>
              <p className="eve-palette__section">{section}</p>
              {filtered
                .filter((command) => command.section === section)
                .map((command) => {
                  const index = filtered.indexOf(command);
                  return (
                    <button
                      key={command.id}
                      type="button"
                      className={index === active ? 'eve-palette__item is-active' : 'eve-palette__item'}
                      onMouseEnter={() => setHighlight(index)}
                      onClick={() => run(command)}
                    >
                      <span className="eve-palette__label">{command.label}</span>
                      {command.hint && (
                        <span className="eve-palette__hint eve-dim" title={command.hint}>
                          {command.hint}
                        </span>
                      )}
                    </button>
                  );
                })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
