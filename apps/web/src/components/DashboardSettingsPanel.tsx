'use client';

import type { GeneralSettings } from '@eve/core/dashboard';
import { strings } from '@eve/ui';
import type { JSX } from 'react';

export interface DashboardSettingsPanelProps {
  settings: GeneralSettings;
  onChange: (patch: Partial<GeneralSettings>) => void;
}

/**
 * Content of the gear panel: dashboard-wide appearance and behavior, as
 * opposed to per-widget settings (which live in each widget's own menu).
 * Every field writes straight through `onChange` — DashboardShell already
 * debounces persistence, so there's no separate "apply" step here.
 */
export function DashboardSettingsPanel({ settings, onChange }: DashboardSettingsPanelProps): JSX.Element {
  return (
    <div className="eve-setup eve-settings">
      <div className="eve-setup__head">
        <strong>{strings.dock.settingsTitle}</strong>
      </div>

      <section className="eve-settings__section">
        <h4 className="eve-settings__section-title">{strings.dashboardSettings.backgroundTitle}</h4>

        <label className="eve-field">
          <span className="eve-field__label">{strings.dashboardSettings.backgroundImage}</span>
          <input
            className="eve-input"
            type="url"
            placeholder="https://..."
            value={settings.backgroundImage ?? ''}
            onChange={(event) => onChange({ backgroundImage: event.target.value || null })}
          />
          <span className="eve-setup__hint">{strings.dashboardSettings.backgroundImageHint}</span>
        </label>

        <label className="eve-field">
          <span className="eve-field__label">{strings.dashboardSettings.backgroundColor}</span>
          <input
            className="eve-input"
            type="text"
            placeholder="#1a1a1a"
            value={settings.backgroundColor ?? ''}
            onChange={(event) => onChange({ backgroundColor: event.target.value || null })}
          />
          <span className="eve-setup__hint">{strings.dashboardSettings.backgroundColorHint}</span>
        </label>
      </section>

      <section className="eve-settings__section">
        <h4 className="eve-settings__section-title">{strings.dashboardSettings.layoutTitle}</h4>

        <label className="eve-field">
          <span className="eve-field__label">{strings.dashboardSettings.density}</span>
          <select
            className="eve-input"
            value={settings.density}
            onChange={(event) => onChange({ density: event.target.value as GeneralSettings['density'] })}
          >
            <option value="comfortable">{strings.dashboardSettings.densityComfortable}</option>
            <option value="compact">{strings.dashboardSettings.densityCompact}</option>
          </select>
        </label>
      </section>

      <section className="eve-settings__section">
        <h4 className="eve-settings__section-title">{strings.dashboardSettings.behaviorTitle}</h4>

        <label className="eve-check">
          <input
            type="checkbox"
            checked={settings.liveUpdates}
            onChange={(event) => onChange({ liveUpdates: event.target.checked })}
          />
          <span>{strings.dashboardSettings.liveUpdates}</span>
        </label>
        <p className="eve-setup__hint">{strings.dashboardSettings.liveUpdatesHint}</p>
      </section>

      <button
        type="button"
        className="eve-btn eve-btn--block"
        onClick={() =>
          onChange({ backgroundImage: null, backgroundColor: null, density: 'comfortable', liveUpdates: true })
        }
      >
        {strings.dashboardSettings.reset}
      </button>
    </div>
  );
}
