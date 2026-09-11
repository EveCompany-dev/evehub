'use client';

import { strings } from '@eve/ui';
import { useEffect, useMemo, useRef, useState, type JSX } from 'react';

export interface PaletteCommand {
  id: string;
  label: string;
  hint?: string;
  section: string;
  run: () => void | Promise<void>;
}

/**
 * Ctrl+K shell.
 *
 * Only navigation and "adicionar widget" for now, but this is deliberately the
 * home for three things already on the backlog — busca global, the global
 * client selector, and keyboard shortcuts. Each becomes a list of commands
 * rather than a new piece of UI.
 */
export function CommandPalette({ commands }: { commands: PaletteCommand[] }): JSX.Element | null {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [highlight, setHighlight] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setOpen((value) => !value);
        setQuery('');
        setHighlight(0);
      }
      if (event.key === 'Escape') setOpen(false);
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) return commands;
    return commands.filter((command) => `${command.label} ${command.hint ?? ''}`.toLowerCase().includes(term));
  }, [commands, query]);

  if (!open) return null;

  const run = (command: PaletteCommand) => {
    setOpen(false);
    void command.run();
  };

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
              setHighlight((index) => Math.min(index + 1, filtered.length - 1));
            }
            if (event.key === 'ArrowUp') {
              event.preventDefault();
              setHighlight((index) => Math.max(index - 1, 0));
            }
            if (event.key === 'Enter') {
              const command = filtered[highlight];
              if (command) run(command);
            }
          }}
        />

        <div className="eve-palette__list">
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
                      className={index === highlight ? 'eve-palette__item is-active' : 'eve-palette__item'}
                      onMouseEnter={() => setHighlight(index)}
                      onClick={() => run(command)}
                    >
                      <span>{command.label}</span>
                      {command.hint && <span className="eve-dim">{command.hint}</span>}
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
