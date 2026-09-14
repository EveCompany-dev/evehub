'use client';

import type { GeneralSettings } from '@eve/core/dashboard';
import { strings } from '@eve/ui';
import { useEffect, useRef, useState, type DragEvent, type JSX } from 'react';

export interface SettingsSectionProps {
  settings: GeneralSettings;
  onChange: (patch: Partial<GeneralSettings>) => void;
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

      <label className="eve-field">
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
  );
}

export function LayoutSection({ settings, onChange }: SettingsSectionProps): JSX.Element {
  return (
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
  );
}

export function InterfaceSection({ settings, onChange }: SettingsSectionProps): JSX.Element {
  // The slider's in-flight value, so the % label tracks the thumb while the
  // user drags. The page `zoom` itself is only touched on release — see
  // `commitScale`.
  const [draftScale, setDraftScale] = useState(settings.uiScale);

  // Adopt the value when it changes from outside this component (settings
  // reloaded, another device, a reset), but not while a drag is in flight.
  const draggingRef = useRef(false);
  useEffect(() => {
    if (!draggingRef.current) setDraftScale(settings.uiScale);
  }, [settings.uiScale]);

  /**
   * Writing `zoom` on every input event re-lays out the page *underneath the
   * pointer* mid-drag: the slider itself grows or shrinks, the thumb slides
   * out from under the cursor, and the next pointer sample therefore reads a
   * different value — the drag ends up fighting its own side effect and the
   * handle judders instead of following the mouse. Committing once, on
   * release, keeps the geometry still for the whole drag; the label below
   * still updates live so the interaction stays legible.
   */
  const commitScale = () => {
    draggingRef.current = false;
    if (draftScale === settings.uiScale) return;
    document.documentElement.style.zoom = String(draftScale);
    onChange({ uiScale: draftScale });
  };

  return (
    <section className="eve-settings__section">
      <h4 className="eve-settings__section-title">{strings.dashboardSettings.interfaceTitle}</h4>

      <label className="eve-field">
        <span className="eve-field__label">
          {strings.dashboardSettings.uiScale} — {Math.round(draftScale * 100)}%
        </span>
        <input
          type="range"
          min={0.5}
          max={2}
          step={0.05}
          value={draftScale}
          onPointerDown={() => {
            draggingRef.current = true;
          }}
          onChange={(event) => setDraftScale(Number(event.target.value))}
          onPointerUp={commitScale}
          onPointerCancel={commitScale}
          onKeyUp={commitScale}
          onBlur={commitScale}
        />
        <span className="eve-setup__hint">{strings.dashboardSettings.uiScaleHint}</span>
      </label>

      <label className="eve-check">
        <input
          type="checkbox"
          checked={settings.railFullHide}
          onChange={(event) => onChange({ railFullHide: event.target.checked })}
        />
        <span>{strings.dashboardSettings.railFullHide}</span>
      </label>
      <p className="eve-setup__hint">{strings.dashboardSettings.railFullHideHint}</p>
    </section>
  );
}

export function BehaviorSection({ settings, onChange }: SettingsSectionProps): JSX.Element {
  return (
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
  );
}

export interface SettingsCategory {
  id: string;
  label: string;
  Section: (props: SettingsSectionProps) => JSX.Element;
}

/** Drives the /settings page's category side nav. */
export const SETTINGS_CATEGORIES: SettingsCategory[] = [
  { id: 'appearance', label: strings.dashboardSettings.backgroundTitle, Section: AppearanceSection },
  { id: 'interface', label: strings.dashboardSettings.interfaceTitle, Section: InterfaceSection },
  { id: 'layout', label: strings.dashboardSettings.layoutTitle, Section: LayoutSection },
  { id: 'behavior', label: strings.dashboardSettings.behaviorTitle, Section: BehaviorSection },
];
