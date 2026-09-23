'use client';

import type { FieldSchema } from '@eve/connector-sdk';
import type { ViewConfig } from '@eve/core/dashboard';
import { ArrowDown, ArrowUp, SettingsRow, SettingsSection, strings } from '@eve/ui';
import { useId, type JSX } from 'react';

export interface ViewConfigMenuProps {
  allFields: FieldSchema[];
  value: ViewConfig | null;
  onChange: (next: ViewConfig) => void;
}

/**
 * Lets the user pick which fields show and in what order, and switch between
 * table/stat-cards — the whole point of a config-driven view: no widget code
 * changes to reshape what's on screen. Lives on the Geral page of the
 * widget's settings card (⋮), as two sections.
 */
export function ViewConfigMenu({ allFields, value, onChange }: ViewConfigMenuProps): JSX.Element {
  const kindId = useId();
  const kind = value?.kind ?? 'table';
  const selected = value?.fields ?? allFields.map((field) => field.key);

  /** Keeps whatever else the view carries (the widget's own options) intact. */
  const emit = (patch: Partial<ViewConfig>): void => {
    onChange({ ...value, kind, fields: value?.fields ?? null, ...patch });
  };

  const toggleField = (key: string): void => {
    emit({ fields: selected.includes(key) ? selected.filter((item) => item !== key) : [...selected, key] });
  };

  const move = (key: string, delta: number): void => {
    const index = selected.indexOf(key);
    const target = index + delta;
    if (index < 0 || target < 0 || target >= selected.length) return;
    const next = [...selected];
    [next[index], next[target]] = [next[target] as string, next[index] as string];
    emit({ fields: next });
  };

  return (
    <>
      <SettingsSection title={strings.view.configure}>
        <SettingsRow label={strings.view.kindLabel} htmlFor={kindId}>
          <select
            id={kindId}
            className="eve-input"
            value={kind}
            onChange={(event) => emit({ kind: event.target.value as ViewConfig['kind'] })}
          >
            <option value="table">{strings.view.kindTable}</option>
            <option value="stat-cards">{strings.view.kindStatCards}</option>
          </select>
        </SettingsRow>
      </SettingsSection>

      <SettingsSection title={strings.view.fieldsTitle} description={strings.view.fieldsHint}>
        {allFields.length === 0 ? (
          <p className="eve-dim">{strings.view.noFields}</p>
        ) : (
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
                        aria-label={`Mover ${field.label} para cima`}
                      >
                        <ArrowUp size={14} aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        className="eve-btn eve-btn--icon"
                        disabled={index >= selected.length - 1}
                        onClick={() => move(field.key, 1)}
                        aria-label={`Mover ${field.label} para baixo`}
                      >
                        <ArrowDown size={14} aria-hidden="true" />
                      </button>
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        <div className="eve-settings__buttons">
          <button type="button" className="eve-btn" onClick={() => emit({ fields: null })}>
            {strings.view.reset}
          </button>
        </div>
      </SettingsSection>
    </>
  );
}
