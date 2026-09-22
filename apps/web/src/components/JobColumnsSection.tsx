'use client';

import { strings } from '@eve/ui';
import { useEffect, useRef, useState, type JSX } from 'react';
import { hexToRgba, type JobColumnSummary } from './job-types';

const SAVE_DEBOUNCE_MS = 500;
const DEFAULT_OPACITY = 1;

type ColorPatch = Partial<{ color: string | null; colorOpacity: number | null; borderColor: string | null }>;

interface ColumnColorDraft {
  color: string;
  colorOpacity: number;
  borderColor: string;
}

function isValidHex(value: string): boolean {
  return /^#[0-9a-fA-F]{6}$/.test(value.trim());
}

function toDraft(column: JobColumnSummary): ColumnColorDraft {
  return {
    color: column.color ?? '',
    colorOpacity: column.colorOpacity ?? DEFAULT_OPACITY,
    borderColor: column.borderColor ?? '',
  };
}

/**
 * Admin-only, rendered on the Equipe page (app/team/page.tsx) because it
 * edits JobColumn rows — a value shared by the whole team — not anyone's
 * personal dashboardConfig. It fetches and saves on its own. The API still re-checks isOwner server-side (see
 * app/api/jobs/columns/[id]/route.ts) — this component hiding the controls
 * is a UX nicety, not the actual guard.
 */
export function JobColumnsSection(): JSX.Element {
  const [columns, setColumns] = useState<JobColumnSummary[] | null>(null);
  const [drafts, setDrafts] = useState<Record<string, ColumnColorDraft>>({});
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveErrors, setSaveErrors] = useState<Record<string, string>>({});
  const [savingIds, setSavingIds] = useState<Set<string>>(new Set());
  const saveTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  // Merges rapid successive edits (color then opacity within the debounce
  // window) into one PATCH — keying the timer alone would drop whichever
  // field changed first when a second edit resets it.
  const pendingPatches = useRef<Record<string, ColorPatch>>({});

  useEffect(() => {
    // Mount fetch — same legitimate case as useWidgetData.ts's initial fetch.
    void (async () => {
      try {
        const response = await fetch('/api/jobs/columns', { cache: 'no-store' });
        const body = (await response.json().catch(() => ({}))) as { columns?: JobColumnSummary[]; error?: string };
        if (!response.ok || !body.columns) {
          setLoadError(body.error ?? strings.jobs.columnColorsLoadError);
          return;
        }
        setColumns(body.columns);
        setDrafts(Object.fromEntries(body.columns.map((column) => [column.id, toDraft(column)])));
      } catch (cause) {
        setLoadError(cause instanceof Error ? cause.message : String(cause));
      }
    })();
  }, []);

  useEffect(
    () => () => {
      Object.values(saveTimers.current).forEach(clearTimeout);
    },
    [],
  );

  const persist = (id: string, patch: ColorPatch) => {
    pendingPatches.current[id] = { ...pendingPatches.current[id], ...patch };
    if (saveTimers.current[id]) clearTimeout(saveTimers.current[id]);
    setSavingIds((current) => new Set(current).add(id));

    saveTimers.current[id] = setTimeout(() => {
      const body = pendingPatches.current[id];
      delete pendingPatches.current[id];
      void (async () => {
        try {
          const response = await fetch(`/api/jobs/columns/${id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          });
          const responseBody = (await response.json().catch(() => ({}))) as { error?: string };
          setSaveErrors((current) => {
            const next = { ...current };
            if (!response.ok) next[id] = responseBody.error ?? strings.jobs.columnColorSaveError;
            else delete next[id];
            return next;
          });
        } catch (cause) {
          setSaveErrors((current) => ({ ...current, [id]: cause instanceof Error ? cause.message : String(cause) }));
        } finally {
          setSavingIds((current) => {
            const next = new Set(current);
            next.delete(id);
            return next;
          });
        }
      })();
    }, SAVE_DEBOUNCE_MS);
  };

  const updateDraft = (id: string, patch: Partial<ColumnColorDraft>) => {
    setDrafts((current) => ({ ...current, [id]: { ...current[id]!, ...patch } }));
  };

  if (loadError) return <p className="eve-alert eve-alert--error">{loadError}</p>;
  if (!columns) return <p className="eve-dim">carregando...</p>;

  return (
    <section className="eve-settings__section">
      <h4 className="eve-settings__section-title">{strings.jobs.columnColorsTitle}</h4>
      <p className="eve-setup__hint">{strings.jobs.columnColorsHint}</p>

      {columns.map((column) => {
        const draft = drafts[column.id] ?? toDraft(column);
        const colorValid = draft.color === '' || isValidHex(draft.color);
        const borderValid = draft.borderColor === '' || isValidHex(draft.borderColor);

        return (
          <div key={column.id} className="eve-jobs__color-row">
            <span
              className="eve-jobs__color-preview"
              style={
                colorValid && draft.color
                  ? {
                      backgroundColor: hexToRgba(draft.color, draft.colorOpacity),
                      borderColor: borderValid && draft.borderColor ? draft.borderColor : draft.color,
                    }
                  : undefined
              }
            >
              {column.name}
            </span>

            <label className="eve-field">
              <span className="eve-field__label">{strings.jobs.columnColor}</span>
              <input
                className="eve-input"
                type="text"
                placeholder="#3B82F6"
                value={draft.color}
                onChange={(event) => {
                  const color = event.target.value;
                  updateDraft(column.id, { color });
                  if (color === '' || isValidHex(color)) persist(column.id, { color: color || null });
                }}
              />
            </label>

            <label className="eve-field">
              <span className="eve-field__label">
                {strings.jobs.columnColorOpacity} — {Math.round(draft.colorOpacity * 100)}%
              </span>
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={draft.colorOpacity}
                onChange={(event) => {
                  const colorOpacity = Number(event.target.value);
                  updateDraft(column.id, { colorOpacity });
                  persist(column.id, { colorOpacity });
                }}
              />
            </label>

            <label className="eve-field">
              <span className="eve-field__label">{strings.jobs.columnBorderColor}</span>
              <input
                className="eve-input"
                type="text"
                placeholder="#3B82F6"
                value={draft.borderColor}
                onChange={(event) => {
                  const borderColor = event.target.value;
                  updateDraft(column.id, { borderColor });
                  if (borderColor === '' || isValidHex(borderColor)) persist(column.id, { borderColor: borderColor || null });
                }}
              />
            </label>

            {draft.color && (
              <button
                type="button"
                className="eve-btn"
                onClick={() => {
                  updateDraft(column.id, { color: '', colorOpacity: DEFAULT_OPACITY, borderColor: '' });
                  persist(column.id, { color: null, colorOpacity: null, borderColor: null });
                }}
              >
                {strings.jobs.columnColorClear}
              </button>
            )}

            {savingIds.has(column.id) && <span className="eve-dim">{strings.jobs.columnColorSaving}</span>}
            {saveErrors[column.id] && <p className="eve-alert eve-alert--error">{saveErrors[column.id]}</p>}
          </div>
        );
      })}
    </section>
  );
}
