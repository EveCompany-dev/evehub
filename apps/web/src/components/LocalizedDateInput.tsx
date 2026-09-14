'use client';

import { useRef, useState, type JSX } from 'react';

export interface LocalizedDateInputProps {
  value: string | null;
  onChange: (isoOrNull: string | null) => void;
}

function isoToDisplay(value: string | null): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  return `${day}/${month}/${date.getFullYear()}`;
}

function isoToNativeValue(value: string | null): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toISOString().slice(0, 10);
}

function maskDigits(raw: string): string {
  const digits = raw.replace(/\D/g, '').slice(0, 8);
  return [digits.slice(0, 2), digits.slice(2, 4), digits.slice(4, 8)].filter(Boolean).join('/');
}

function parseDisplay(display: string): string | null {
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(display);
  if (!match) return null;
  const day = Number(match[1]);
  const month = Number(match[2]);
  const year = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return date.toISOString();
}

/**
 * A native <input type=date> formats itself per the browser/OS locale, not
 * the page's `lang` — so it can't be trusted to show DD/MM/AAAA for a pt-BR
 * team. This pairs a masked pt-BR text field (the real interaction) with a
 * hidden native date input used only for its picker UI.
 */
export function LocalizedDateInput({ value, onChange }: LocalizedDateInputProps): JSX.Element {
  const [display, setDisplay] = useState(() => isoToDisplay(value));
  const [invalid, setInvalid] = useState(false);
  const [syncedValue, setSyncedValue] = useState(value);
  const nativeRef = useRef<HTMLInputElement>(null);

  // Re-derive the display text when the `value` prop changes from outside
  // (e.g. after a save round-trip) — adjusting state during render per
  // https://react.dev/learn/you-might-not-need-an-effect, not an effect,
  // so there's no cascading-render lint concern.
  if (value !== syncedValue) {
    setSyncedValue(value);
    setDisplay(isoToDisplay(value));
    setInvalid(false);
  }

  const commit = (raw: string) => {
    if (!raw) {
      setInvalid(false);
      onChange(null);
      return;
    }
    const iso = parseDisplay(raw);
    if (!iso) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    onChange(iso);
  };

  return (
    <span className="eve-date-input">
      <input
        className={invalid ? 'eve-input eve-date-input__text is-invalid' : 'eve-input eve-date-input__text'}
        type="text"
        inputMode="numeric"
        placeholder="dd/mm/aaaa"
        value={display}
        onChange={(event) => setDisplay(maskDigits(event.target.value))}
        onBlur={(event) => commit(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') commit(display);
        }}
      />
      <button
        type="button"
        className="eve-btn eve-btn--icon"
        title="Escolher no calendario"
        onClick={() => {
          const picker = nativeRef.current as (HTMLInputElement & { showPicker?: () => void }) | null;
          if (picker?.showPicker) picker.showPicker();
          else picker?.focus();
        }}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <rect x="3.5" y="5" width="17" height="15" rx="2" stroke="currentColor" strokeWidth="2" />
          <path d="M3.5 9.5h17M8 3v4M16 3v4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
      </button>
      <input
        ref={nativeRef}
        type="date"
        className="eve-date-input__native"
        tabIndex={-1}
        aria-hidden="true"
        value={isoToNativeValue(value)}
        onChange={(event) => {
          const raw = event.target.value;
          onChange(raw ? new Date(`${raw}T00:00:00.000Z`).toISOString() : null);
        }}
      />
    </span>
  );
}
