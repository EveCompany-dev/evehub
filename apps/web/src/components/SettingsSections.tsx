'use client';

import type { GeneralSettings } from '@eve/core/dashboard';
import { strings } from '@eve/ui';
import { useRef, useState, type DragEvent, type JSX } from 'react';
import { landingOptions } from '../lib/navigation';

export interface SettingsSectionProps {
  settings: GeneralSettings;
  onChange: (patch: Partial<GeneralSettings>) => void;
  /** Tabs the user can see — limits the choice of default page to pages they can actually open. */
  visibleTabs?: readonly string[];
}

/**
 * One category's fields, each in its own component so `/settings` can
 * render one category at a time behind a side nav while sharing the exact
 * same field markup and onChange wiring across categories.
 */
export function AppearanceSection({ settings, onChange }: SettingsSectionProps): JSX.Element {
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const uploadBackground = async (file: File) => {
    setUploading(true);
    setUploadError(null);
    try {
      const form = new FormData();
      form.append('file', file);
      const response = await fetch('/api/uploads/background', { method: 'POST', body: form });
      const body = (await response.json().catch(() => ({}))) as { url?: string; error?: string };
      if (!response.ok || !body.url) {
        setUploadError(body.error ?? `HTTP ${response.status}`);
        return;
      }
      onChange({ backgroundImage: body.url });
    } catch (cause) {
      setUploadError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setUploading(false);
    }
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragOver(false);
    const file = event.dataTransfer.files[0];
    if (file) void uploadBackground(file);
  };

  return (
    <section className="eve-settings__section">
      <h4 className="eve-settings__section-title">{strings.dashboardSettings.backgroundTitle}</h4>

      <label className="eve-field" data-setting-id="backgroundImage">
        <span className="eve-field__label">{strings.dashboardSettings.backgroundImage}</span>
        <div
          className={dragOver ? 'eve-upload-drop is-drag-over' : 'eve-upload-drop'}
          onClick={() => fileInputRef.current?.click()}
          onDragOver={(event) => {
            event.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
        >
          {settings.backgroundImage ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img className="eve-upload-drop__preview" src={settings.backgroundImage} alt="" />
          ) : (
            <span className="eve-dim">
              {uploading ? strings.dashboardSettings.backgroundImageUploading : strings.dashboardSettings.backgroundImageDropZone}
            </span>
          )}
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif"
          hidden
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void uploadBackground(file);
            event.target.value = '';
          }}
        />
        {settings.backgroundImage && (
          <button type="button" className="eve-btn" onClick={() => onChange({ backgroundImage: null })}>
            {strings.dashboardSettings.backgroundImageRemove}
          </button>
        )}
        {uploadError && <p className="eve-alert eve-alert--error">{uploadError}</p>}
        <span className="eve-setup__hint">{strings.dashboardSettings.backgroundImageHint}</span>
      </label>

      <label className="eve-field" data-setting-id="backgroundColor">
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
  );
}

/**
 * Applies the UI scale live. Writes into the same `<style id="eve-ui-scale">`
 * tag that layout.tsx server-renders on first paint, instead of setting
 * `document.documentElement.style.zoom` directly. Both approaches render
 * identically at the instant they run, but a bare inline style on <html>
 * competed with that server-rendered tag on the next navigation (App Router
 * re-renders the root layout — and this same style tag with the DB's value —
 * on most route changes since it reads the session), which intermittently
 * snapped the page back to the last-saved scale right after an edit. Writing
 * through the tag itself means there is only ever one place controlling the
 * zoom, so a later re-render just replaces its content with the same
 * (already-persisted) value instead of overriding a competing inline style.
 */
export function applyUiScale(scale: number): void {
  const styleTag = document.getElementById('eve-ui-scale');
  if (styleTag) styleTag.textContent = `html { zoom: ${scale}; }`;
  else document.documentElement.style.zoom = String(scale);
}

export function InterfaceSection({ settings, onChange }: SettingsSectionProps): JSX.Element {
  return (
    <section className="eve-settings__section">
      <h4 className="eve-settings__section-title">{strings.dashboardSettings.interfaceTitle}</h4>

      <label className="eve-check" data-setting-id="railFullHide">
        <input
          type="checkbox"
          checked={settings.railFullHide}
          onChange={(event) => onChange({ railFullHide: event.target.checked })}
        />
        <span>{strings.dashboardSettings.railFullHide}</span>
      </label>
      <p className="eve-setup__hint">{strings.dashboardSettings.railFullHideHint}</p>

      <label className="eve-check" data-setting-id="cursorFollower">
        <input
          type="checkbox"
          checked={settings.cursorFollower}
          onChange={(event) => {
            const cursorFollower = event.target.checked;
            // Applied live for the same reason the scale is: the root layout
            // only renders <CustomCursor /> and this attribute on page load,
            // so without this the dot would linger (or stay missing) until a
            // reload. The mount itself is settled server-side next load.
            document.documentElement.dataset.cursorFollower = cursorFollower ? 'on' : 'off';
            onChange({ cursorFollower });
          }}
        />
        <span>{strings.dashboardSettings.cursorFollower}</span>
      </label>
      <p className="eve-setup__hint">{strings.dashboardSettings.cursorFollowerHint}</p>
    </section>
  );
}

export function BehaviorSection({ settings, onChange, visibleTabs = [] }: SettingsSectionProps): JSX.Element {
  const pages = landingOptions(visibleTabs);
  return (
    <section className="eve-settings__section">
      <h4 className="eve-settings__section-title">{strings.dashboardSettings.behaviorTitle}</h4>

      <label className="eve-check" data-setting-id="liveUpdates">
        <input
          type="checkbox"
          checked={settings.liveUpdates}
          onChange={(event) => onChange({ liveUpdates: event.target.checked })}
        />
        <span>{strings.dashboardSettings.liveUpdates}</span>
      </label>
      <p className="eve-setup__hint">{strings.dashboardSettings.liveUpdatesHint}</p>

      <label className="eve-field" data-setting-id="defaultPage">
        <span className="eve-field__label">{strings.dashboardSettings.defaultPage}</span>
        <select
          className="eve-input"
          value={settings.defaultPage ?? '/'}
          onChange={(event) => onChange({ defaultPage: event.target.value === '/' ? null : event.target.value })}
        >
          <option value="/">{strings.dashboard.title}</option>
          {pages
            .filter((page) => page.href !== '/')
            .map((page) => (
              <option key={page.href} value={page.href}>
                {page.label}
              </option>
            ))}
        </select>
      </label>
      <p className="eve-setup__hint">{strings.dashboardSettings.defaultPageHint}</p>
    </section>
  );
}

/**
 * Personal preferences only. Anything that applies to the whole team (the
 * Jobs status colors) lives on the Equipe page instead.
 */
export interface SettingsCategory {
  id: string;
  label: string;
  Section: (props: SettingsSectionProps) => JSX.Element;
}

/** Drives the /settings page's category side nav. */
export const SETTINGS_CATEGORIES: SettingsCategory[] = [
  { id: 'appearance', label: strings.dashboardSettings.backgroundTitle, Section: AppearanceSection },
  { id: 'interface', label: strings.dashboardSettings.interfaceTitle, Section: InterfaceSection },
  { id: 'behavior', label: strings.dashboardSettings.behaviorTitle, Section: BehaviorSection },
];
