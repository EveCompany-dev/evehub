'use client';

import { ChevronDown } from '@eve/ui';
import { useState, type JSX } from 'react';
import { ChoicePopover, type Choice } from './ChoicePopover';

export interface TagFilterProps {
  label: string;
  choices: Choice[];
  selected: string[];
  onChange: (next: string[]) => void;
}

/**
 * One filter of a Notion-style filter row: "Cliente ▾" until something is
 * picked, then the picked tags themselves (the same pills the tables use).
 * Several tags in one filter are alternatives.
 */
export function TagFilter({ label, choices, selected, onChange }: TagFilterProps): JSX.Element {
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  const picked = choices.filter((choice) => selected.includes(choice.id));

  return (
    <>
      <button
        type="button"
        className={picked.length > 0 ? 'eve-tagfilter is-active' : 'eve-tagfilter'}
        aria-haspopup="dialog"
        onClick={(event) => setAnchor(event.currentTarget.getBoundingClientRect())}
      >
        <span className="eve-tagfilter__label">{label}</span>
        {picked.slice(0, 2).map((choice) => (
          <span key={choice.id} className="eve-tagfilter__pill">
            {choice.node}
          </span>
        ))}
        {picked.length > 2 && <span className="eve-dim">+{picked.length - 2}</span>}
        <ChevronDown size={12} aria-hidden="true" />
      </button>

      {anchor && (
        <ChoicePopover
          anchor={anchor}
          choices={choices}
          selected={selected}
          multi
          onToggle={(id) => onChange(selected.includes(id) ? selected.filter((item) => item !== id) : [...selected, id])}
          onClear={() => onChange([])}
          onClose={() => setAnchor(null)}
          emptyText="Nada para filtrar ainda."
        />
      )}
    </>
  );
}
