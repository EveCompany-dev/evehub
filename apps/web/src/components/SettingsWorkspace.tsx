'use client';

import type { DashboardConfig, GeneralSettings } from '@eve/core/dashboard';
import { updateGeneralSettings } from '@eve/core/dashboard';
import { strings } from '@eve/ui';
import { useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useRef, useState, type JSX } from 'react';
import { applyUiScale, SETTINGS_CATEGORIES } from './SettingsSections';

const SAVE_DEBOUNCE_MS = 500;

/**
 * Full-page settings: same per-user dashboardConfig as the rail's gear
 * popover, laid out as one category at a time behind a side nav instead of
 * everything stacked in a cramped panel. Holds its own config copy (same
 * tradeoff as RailSettings.tsx) — a change made here needs a reload to show
 * up live on the dashboard page.
 */
export interface SettingsWorkspaceProps {
  isOwner: boolean;
  visibleTabs: readonly string[];
}

export function SettingsWorkspace({ isOwner, visibleTabs }: SettingsWorkspaceProps): JSX.Element {
  const searchParams = useSearchParams();
  const requestedCategory = searchParams.get('category');
  const requestedOption = searchParams.get('option');

  const categories = SETTINGS_CATEGORIES.filter((category) => !category.ownerOnly || isOwner);

  const [config, setConfig] = useState<DashboardConfig | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activeId, setActiveId] = useState(
    // Ctrl+K deep-links straight to one control: `?category=` picks the pane
    // before first paint so the user never sees the wrong one flash past.
    () => categories.find((category) => category.id === requestedCategory)?.id ?? categories[0]!.id,
  );
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

  /**
   * Highlights the control named by `?option=` once its category is on
   * screen. Waits for `config`, because the sections don't render at all
   * until the settings have loaded and there would be nothing to scroll to.
   */
  useEffect(() => {
    if (!requestedOption || !config) return;

    const target = document.querySelector<HTMLElement>(`[data-setting-id="${requestedOption}"]`);
    if (!target) return;

    target.scrollIntoView({ block: 'center', behavior: 'smooth' });
    target.classList.add('is-highlighted');
    const timer = setTimeout(() => target.classList.remove('is-highlighted'), 2200);
    return () => clearTimeout(timer);
  }, [config, requestedOption, activeId]);

  const handleChange = (patch: Partial<GeneralSettings>) => {
    setConfig((current) => {
      if (!current) return current;
      const next = updateGeneralSettings(current, patch);
      persist(next);
      return next;
    });
  };

  const active = categories.find((category) => category.id === activeId) ?? categories[0]!;
  const ActiveSection = active.Section;

  return (
    <div className="eve-settings-page">
      <nav className="eve-settings-page__nav" aria-label="Categorias de configuração">
        {categories.map((category) => (
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
            <ActiveSection settings={config} onChange={handleChange} visibleTabs={visibleTabs} />

            <button
              type="button"
              className="eve-btn eve-btn--block"
              onClick={() => {
                // Same live-apply the Interface toggle does, so a reset puts
                // the dot back on the spot instead of on next load.
                document.documentElement.dataset.cursorFollower = 'on';
                applyUiScale(1);
                handleChange({
                  backgroundImage: null,
                  backgroundColor: null,
                  density: 'comfortable',
                  liveUpdates: true,
                  uiScale: 1,
                  railFullHide: false,
                  cursorFollower: true,
                  defaultPage: null,
                });
              }}
            >
              {strings.dashboardSettings.reset}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
