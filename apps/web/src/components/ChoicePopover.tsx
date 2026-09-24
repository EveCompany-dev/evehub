'use client';

import { useMemo, useState, type JSX, type ReactNode } from 'react';
import { Popover } from './Popover';
import { Check } from '@eve/ui';
import { fold } from '../lib/fold';

export interface Choice {
  id: string;
  label: string;
  node: ReactNode;
}

export interface ChoicePopoverProps {
  anchor: DOMRect;
  choices: Choice[];
  selected: string[];
  /** true = tick several (tags); false = pick one and close (status, client). */
  multi: boolean;
  onToggle: (id: string) => void;
  onClear?: () => void;
  onClose: () => void;
  /** Offers "Criar «text»" when the search matches nothing exactly. */
  onCreate?: (label: string) => void | Promise<void>;
  createNoun?: string;
  emptyText?: string;
}

/**
 * The picker behind every tag / status / client cell: search box, colored
 * choices with ticks, and create-on-the-fly. One component so a status, a
 * tag list and a client relation all feel the same to use.
 */
export function ChoicePopover({
  anchor,
  choices,
  selected,
  multi,
  onToggle,
  onClear,
  onClose,
  onCreate,
  createNoun = 'opção',
  emptyText = 'Nada aqui ainda.',
}: ChoicePopoverProps): JSX.Element {
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);

  const visible = useMemo(() => {
    const needle = fold(query.trim());
    return needle ? choices.filter((choice) => fold(choice.label).includes(needle)) : choices;
  }, [choices, query]);

  const trimmed = query.trim();
  const canCreate = Boolean(onCreate) && trimmed !== '' && !choices.some((choice) => fold(choice.label) === fold(trimmed));

  const pick = (id: string) => {
    onToggle(id);
    if (!multi) onClose();
    else setQuery('');
  };

  const create = async () => {
    if (!onCreate || !canCreate || busy) return;
    setBusy(true);
    try {
      await onCreate(trimmed);
      setQuery('');
      if (!multi) onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Popover anchor={anchor} onClose={onClose}>
      <input
        className="eve-input eve-popover__search"
        autoFocus
        placeholder={onCreate ? `Buscar ou criar ${createNoun}…` : 'Buscar…'}
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={(event) => {
          if (event.key !== 'Enter') return;
          event.preventDefault();
          if (visible[0]) pick(visible[0].id);
          else void create();
        }}
      />
      <div className="eve-popover__list" role="listbox" aria-multiselectable={multi}>
        {visible.map((choice) => {
          const on = selected.includes(choice.id);
          return (
            <button
              key={choice.id}
              type="button"
              role="option"
              aria-selected={on}
              className={on ? 'eve-popover__item is-selected' : 'eve-popover__item'}
              onClick={() => pick(choice.id)}
            >
              <span className="eve-popover__tick" aria-hidden="true">
                {on ? <Check size={14} aria-hidden="true" /> : null}
              </span>
              {choice.node}
            </button>
          );
        })}
        {visible.length === 0 && !canCreate && <p className="eve-dim eve-popover__empty">{choices.length === 0 ? emptyText : 'Nenhum resultado.'}</p>}
        {canCreate && (
          <button type="button" className="eve-popover__item eve-popover__create" disabled={busy} onClick={() => void create()}>
            <span className="eve-popover__tick" aria-hidden="true">
              +
            </span>
            Criar {createNoun} “{trimmed}”
          </button>
        )}
      </div>
      {onClear && selected.length > 0 && (
        <button
          type="button"
          className="eve-popover__clear"
          onClick={() => {
            onClear();
            onClose();
          }}
        >
          Limpar
        </button>
      )}
    </Popover>
  );
}
