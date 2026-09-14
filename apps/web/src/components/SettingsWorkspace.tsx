'use client';

import type { DashboardConfig, GeneralSettings } from '@eve/core/dashboard';
import { updateGeneralSettings } from '@eve/core/dashboard';
import { strings } from '@eve/ui';
import { useCallback, useEffect, useRef, useState, type JSX } from 'react';
import { SETTINGS_CATEGORIES } from './SettingsSections';

const SAVE_DEBOUNCE_MS = 500;

/**
 * Full-page settings: same per-user dashboardConfig as the rail's gear
 * popover, laid out as one category at a time behind a side nav instead of
 * everything stacked in a cramped panel. Holds its own config copy (same
 * tradeoff as RailSettings.tsx) — a change made here needs a reload to show
 * up live on the dashboard page.
 */
export function SettingsWorkspace(): JSX.Element {
  const [config, setConfig] = useState<DashboardConfig | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activeId, setActiveId] = useState(SETTINGS_CATEGORIES[0]!.id);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    try {
      const response = await fetch('/api/dashboard-config', { cache: 'no-store' });
      const body = (await response.json().catch(() => ({}))) as { config?: DashboardConfig; error?: string };
      if (!response.ok || !body.config) {
        setError(body.error ?? `HTTP ${response.status}`);
        return;
      }
      setConfig(body.config);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, []);

  useEffect(() => {
    // Mount fetch — same legitimate case as useWidgetData.ts's initial fetch.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  useEffect(() => () => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
  }, []);

  const persist = useCallback((next: DashboardConfig) => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      void fetch('/api/dashboard-config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(next),
      });
    }, SAVE_DEBOUNCE_MS);
  }, []);

  const handleChange = (patch: Partial<GeneralSettings>) => {
    setConfig((current) => {
      if (!current) return current;
      const next = updateGeneralSettings(current, patch);
      persist(next);
      return next;
    });
  };

  const active = SETTINGS_CATEGORIES.find((category) => category.id === activeId) ?? SETTINGS_CATEGORIES[0]!;
  const ActiveSection = active.Section;

  return (
    <div className="eve-settings-page">
      <nav className="eve-settings-page__nav" aria-label="Categorias de configuração">
        {SETTINGS_CATEGORIES.map((category) => (
          <button
            key={category.id}
            type="button"
            className={category.id === activeId ? 'eve-settings-page__navitem is-active' : 'eve-settings-page__navitem'}
            onClick={() => setActiveId(category.id)}
          >
            {category.label}
          </button>
        ))}
      </nav>

      <div className="eve-settings-page__content">
        {error && <p className="eve-alert eve-alert--error">{error}</p>}

        {!config ? (
          <p className="eve-dim">carregando...</p>
        ) : (
          <>
            <ActiveSection settings={config} onChange={handleChange} />

            <button
              type="button"
              className="eve-btn eve-btn--block"
              onClick={() =>
                handleChange({
                  backgroundImage: null,
                  backgroundColor: null,
                  density: 'comfortable',
                  liveUpdates: true,
                  uiScale: 1.5,
                  railFullHide: false,
                })
              }
            >
              {strings.dashboardSettings.reset}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
