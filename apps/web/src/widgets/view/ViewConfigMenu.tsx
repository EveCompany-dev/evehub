'use client';

import type { FieldSchema } from '@eve/connector-sdk';
import type { ViewConfig } from '@eve/core/dashboard';
import { ArrowDown, ArrowUp, strings } from '@eve/ui';
import type { JSX } from 'react';

export interface ViewConfigMenuProps {
  allFields: FieldSchema[];
  value: ViewConfig | null;
  onChange: (next: ViewConfig) => void;
  onClose: () => void;
}

/**
 * Lets the user pick which fields show and in what order, and switch between
 * table/stat-cards — the whole point of a config-driven view: no widget code
 * changes to reshape what's on screen. Rendered inline in the widget body
 * (not a floating popover), same visual family as the edit bar.
 */
export function ViewConfigMenu({ allFields, value, onChange, onClose }: ViewConfigMenuProps): JSX.Element {
  const kind = value?.kind ?? 'table';
  const selected = value?.fields ?? allFields.map((field) => field.key);

  const toggleField = (key: string): void => {
    const next = selected.includes(key) ? selected.filter((item) => item !== key) : [...selected, key];
    onChange({ kind, fields: next });
  };

  const move = (key: string, delta: number): void => {
    const index = selected.indexOf(key);
    const target = index + delta;
    if (index < 0 || target < 0 || target >= selected.length) return;
    const next = [...selected];
    [next[index], next[target]] = [next[target] as string, next[index] as string];
    onChange({ kind, fields: next });
  };

  return (
    <div className="eve-alert eve-viewconfig eve-no-drag">
      <div className="eve-viewconfig__row">
        <span className="eve-field__label">{strings.view.configure}</span>
        <select
          className="eve-input"
          value={kind}
          onChange={(event) => onChange({ kind: event.target.value as ViewConfig['kind'], fields: selected })}
        >
          <option value="table">{strings.view.kindTable}</option>
          <option value="stat-cards">{strings.view.kindStatCards}</option>
        </select>
        <button type="button" className="eve-btn" onClick={onClose}>
          {strings.view.close}
        </button>
      </div>

      <span className="eve-field__label">{strings.view.fieldsTitle}</span>
      <ul className="eve-viewconfig__fields">
        {allFields.map((field) => {
          const isOn = selected.includes(field.key);
          const index = selected.indexOf(field.key);
          return (
            <li key={field.key} className="eve-viewconfig__field">
              <label>
                <input type="checkbox" checked={isOn} onChange={() => toggleField(field.key)} />
                {field.label}
              </label>
              {isOn && (
                <span className="eve-viewconfig__order">
                  <button
                    type="button"
                    className="eve-btn eve-btn--icon"
                    disabled={index <= 0}
                    onClick={() => move(field.key, -1)}
                    aria-label="Mover para cima"
                  >
                    <ArrowUp size={14} aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    className="eve-btn eve-btn--icon"
                    disabled={index >= selected.length - 1}
                    onClick={() => move(field.key, 1)}
                    aria-label="Mover para baixo"
                  >
                    <ArrowDown size={14} aria-hidden="true" />
                  </button>
                </span>
              )}
            </li>
          );
        })}
      </ul>

      <button type="button" className="eve-btn" onClick={() => onChange({ kind, fields: null })}>
        {strings.view.reset}
      </button>
    </div>
  );
}
