'use client';

import { useMemo, useRef, useState, type JSX, type KeyboardEvent, type RefObject } from 'react';
import { displayDate, parseLooseDate, toIsoDate } from '../lib/table-dates';
import { ChoicePopover, type Choice } from './ChoicePopover';
import { ImageCell } from './ImageCell';
import type { DataColumn, TableEnv } from './data-table-types';
import { ClientPill, TagPill, TagPills } from './TagPill';
import { CalendarDays } from '@eve/ui';

export interface TableCellProps {
  column: DataColumn;
  value: unknown;
  rowId: string;
  env: TableEnv;
  /** 'grid': click-to-edit inside the table. 'form': always-editable field on the row page. */
  variant: 'grid' | 'form';
  /** Force a one-line input even for text (a row's title). */
  single?: boolean;
}

function isBlank(value: unknown): boolean {
  return value === null || value === undefined || value === '' || (Array.isArray(value) && value.length === 0);
}

function draftFor(column: DataColumn, value: unknown): string {
  if (isBlank(value)) return '';
  return column.type === 'date' ? displayDate(String(value)) : String(value);
}

/**
 * One editable cell, shared by the grid and the row page so a status is
 * picked the same way in both. Tags, status and clients open a search
 * picker; text-like values edit in place (Enter/blur saves, Esc cancels;
 * Shift+Enter is a new line in long text — scripts and captions live here).
 */
export function TableCell({ column, value, rowId, env, variant, single = false }: TableCellProps): JSX.Element {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  const pickerRef = useRef<HTMLSpanElement>(null);
  const dateRef = useRef<HTMLInputElement>(null);

  const save = (next: unknown) => env.saveCell(rowId, column.key, next);

  // --- checkbox -----------------------------------------------------------------
  if (column.type === 'boolean') {
    return (
      <input type="checkbox" className="eve-checkbox" checked={Boolean(value)} onChange={(event) => void save(event.target.checked)} />
    );
  }

  // --- picture: thumbnail with upload / paste-a-link ------------------------------
  if (column.type === 'image') return <ImageCell value={value} save={save} variant={variant} />;

  // --- tags / status / client: search popover --------------------------------------
  if (column.type === 'select' || column.type === 'multiselect' || column.type === 'client') {
    return (
      <ChoiceCell
        column={column}
        value={value}
        env={env}
        buttonRef={pickerRef}
        anchor={anchor}
        onOpen={() => pickerRef.current && setAnchor(pickerRef.current.getBoundingClientRect())}
        onClose={() => setAnchor(null)}
        save={save}
        variant={variant}
      />
    );
  }

  // --- text-like: number, date, link, text ------------------------------------------
  const startEditing = () => {
    setDraft(draftFor(column, value));
    setEditing(true);
  };

  const commit = async () => {
    if (!editing) return;
    setEditing(false);
    const text = draft.trim();
    if (text === draftFor(column, value).trim()) return;
    if (column.type === 'number') {
      const parsed = text === '' ? null : Number(text.replace(',', '.'));
      await save(parsed !== null && Number.isFinite(parsed) ? parsed : null);
    } else {
      await save(text === '' ? null : text);
    }
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      setEditing(false);
    } else if (event.key === 'Enter' && !(column.type === 'text' && !single && event.shiftKey)) {
      event.preventDefault();
      void commit();
    }
  };

  const showInput = variant === 'form' || editing;

  if (showInput) {
    const common = {
      className: single ? 'eve-input eve-cell__input eve-cell__input--title' : 'eve-input eve-cell__input',
      autoFocus: variant === 'grid',
      value: variant === 'form' && !editing ? draftFor(column, value) : draft,
      onFocus: () => {
        if (variant === 'form' && !editing) {
          setDraft(draftFor(column, value));
          setEditing(true);
        }
      },
      onChange: (event: { target: { value: string } }) => {
        if (!editing) setEditing(true);
        setDraft(event.target.value);
      },
      onBlur: () => void commit(),
      onKeyDown,
    };

    return (
      <span className="eve-cell__editor">
        {column.type === 'text' && !single ? (
          <textarea {...common} rows={variant === 'form' ? 4 : Math.min(8, Math.max(2, draft.split('\n').length))} />
        ) : (
          <input {...common} type={column.type === 'number' ? 'number' : 'text'} step={column.type === 'number' ? 'any' : undefined} placeholder={column.type === 'date' ? 'dd/mm/aaaa' : undefined} />
        )}
        {column.type === 'date' && (
          <>
            <button
              type="button"
              className="eve-btn eve-btn--icon eve-cell__datebtn"
              aria-label="Escolher no calendário"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => dateRef.current?.showPicker?.()}
            >
              <CalendarDays size={14} aria-hidden="true" />
            </button>
            <input
              ref={dateRef}
              type="date"
              className="eve-cell__nativedate"
              tabIndex={-1}
              aria-hidden="true"
              value={(() => {
                const parsed = parseLooseDate(draft);
                return parsed ? toIsoDate(parsed) : '';
              })()}
              onChange={(event) => {
                if (!event.target.value) return;
                setEditing(false);
                void save(event.target.value);
              }}
            />
          </>
        )}
      </span>
    );
  }

  return (
    <span className="eve-cell" role="button" tabIndex={0} onClick={startEditing} onKeyDown={(event) => event.key === 'Enter' && startEditing()}>
      {isBlank(value) ? (
        <span className="eve-dim">&mdash;</span>
      ) : column.type === 'url' ? (
        <a className="eve-link eve-cell__link" href={String(value)} target="_blank" rel="noreferrer noopener" onClick={(event) => event.stopPropagation()}>
          {String(value)}
        </a>
      ) : (
        <span className={column.type === 'text' ? 'eve-cell__text' : undefined}>{draftFor(column, value)}</span>
      )}
    </span>
  );
}

interface ChoiceCellProps {
  column: DataColumn;
  value: unknown;
  env: TableEnv;
  buttonRef: RefObject<HTMLSpanElement | null>;
  anchor: DOMRect | null;
  onOpen: () => void;
  onClose: () => void;
  save: (next: unknown) => Promise<void>;
  variant: 'grid' | 'form';
}

function ChoiceCell({ column, value, env, buttonRef, anchor, onOpen, onClose, save, variant }: ChoiceCellProps): JSX.Element {
  const isClient = column.type === 'client';
  const multi = column.type === 'multiselect';
  const current: string[] = Array.isArray(value) ? value.map(String) : isBlank(value) ? [] : [String(value)];

  const choices: Choice[] = useMemo(() => {
    if (isClient) {
      return env.clients.map((client) => ({ id: client.id, label: client.label, node: <ClientPill client={client} /> }));
    }
    // Declared options, plus any value already on the row that the column never declared.
    const options = [...(column.options ?? [])];
    for (const name of current) if (!options.includes(name)) options.push(name);
    return options.map((name) => ({ id: name, label: name, node: <TagPill name={name} color={column.optionColors?.[name]} /> }));
    // `current` is derived from `value`, which is the real dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isClient, env.clients, column.options, column.optionColors, value]);

  const toggle = (id: string) => {
    if (multi) void save(current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
    else void save(current[0] === id ? null : id);
  };

  const create = async (label: string) => {
    if (isClient) {
      const client = await env.createClient(label);
      if (client) await save(client.id);
      return;
    }
    await env.addOption(column.key, label);
    await save(multi ? [...current, label] : label);
  };

  const shown = isClient ? (typeof value === 'string' ? env.clientById[value] : undefined) : null;

  return (
    <>
      <span
        ref={buttonRef}
        role="button"
        tabIndex={0}
        className={variant === 'form' ? 'eve-cell eve-cell--choice eve-cell--form' : 'eve-cell eve-cell--choice'}
        onClick={onOpen}
        onKeyDown={(event) => (event.key === 'Enter' || event.key === ' ') && (event.preventDefault(), onOpen())}
      >
        {isClient ? (
          shown ? (
            <ClientPill client={shown} link />
          ) : isBlank(value) ? (
            <span className="eve-dim">&mdash;</span>
          ) : (
            <span className="eve-dim">cliente removido</span>
          )
        ) : isBlank(value) ? (
          <span className="eve-dim">&mdash;</span>
        ) : (
          <TagPills column={column} value={value} />
        )}
      </span>
      {anchor && (
        <ChoicePopover
          anchor={anchor}
          choices={choices}
          selected={current}
          multi={multi}
          onToggle={toggle}
          onClear={() => void save(multi ? [] : null)}
          onClose={onClose}
          onCreate={create}
          createNoun={isClient ? 'cliente' : multi ? 'tag' : 'opção'}
          emptyText={isClient ? 'Nenhum cliente cadastrado.' : 'Nenhuma opção ainda — digite para criar.'}
        />
      )}
    </>
  );
}
