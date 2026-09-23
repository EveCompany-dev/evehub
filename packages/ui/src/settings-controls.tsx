'use client';

import { useId, type JSX, type ReactNode } from 'react';
import { strings } from './strings';

/**
 * Building blocks for a widget's settings pages, so every card reads the same
 * way: sections with a header and a divider between them, rows with a label
 * and a hint on the left and the control on the right.
 */

export interface SettingsSectionProps {
  title: string;
  description?: ReactNode;
  children: ReactNode;
}

export function SettingsSection({ title, description, children }: SettingsSectionProps): JSX.Element {
  return (
    <section className="eve-settings__section">
      <header className="eve-settings__section-head">
        <h4 className="eve-settings__section-title">{title}</h4>
        {description && <p className="eve-settings__section-desc">{description}</p>}
      </header>
      <div className="eve-settings__section-body">{children}</div>
    </section>
  );
}

export interface SettingsRowProps {
  label: ReactNode;
  hint?: ReactNode;
  /** Id of the control, so clicking the label focuses it. */
  htmlFor?: string;
  badge?: ReactNode;
  children?: ReactNode;
  /** Stacks the control under the label instead of beside it (lists, wide inputs). */
  stacked?: boolean;
}

export function SettingsRow({ label, hint, htmlFor, badge, children, stacked = false }: SettingsRowProps): JSX.Element {
  return (
    <div className={stacked ? 'eve-settings__row is-stacked' : 'eve-settings__row'}>
      <div className="eve-settings__row-text">
        {htmlFor ? (
          <label className="eve-settings__row-label" htmlFor={htmlFor}>
            {label}
            {badge}
          </label>
        ) : (
          <span className="eve-settings__row-label">
            {label}
            {badge}
          </span>
        )}
        {hint && <p className="eve-settings__row-hint">{hint}</p>}
      </div>
      {children !== undefined && <div className="eve-settings__row-control">{children}</div>}
    </div>
  );
}

export interface SettingsToggleProps {
  label: ReactNode;
  hint?: ReactNode;
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  badge?: ReactNode;
}

/** An on/off setting: the row plus a switch (role="switch"), the way settings screens do it. */
export function SettingsToggle({ label, hint, checked, onChange, disabled = false, badge }: SettingsToggleProps): JSX.Element {
  const id = useId();
  return (
    <SettingsRow label={label} hint={hint} htmlFor={id} badge={badge}>
      <Switch id={id} checked={checked} onChange={onChange} disabled={disabled} />
    </SettingsRow>
  );
}

export interface SwitchProps {
  id?: string;
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  label?: string;
}

export function Switch({ id, checked, onChange, disabled = false, label }: SwitchProps): JSX.Element {
  return (
    <button
      id={id}
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      className={checked ? 'eve-switch is-on' : 'eve-switch'}
      onClick={() => onChange(!checked)}
    >
      <span className="eve-switch__thumb" aria-hidden="true" />
    </button>
  );
}

/** "Em desenvolvimento" — marks a control that is shown on purpose but does nothing yet. */
export function DevBadge(): JSX.Element {
  return <span className="eve-devbadge">{strings.widgetSettings.inDevelopment}</span>;
}

/**
 * The Conexão page, for now: where a widget will be pinned to one client or
 * connected account (see `clientOverride` in the dashboard config). A widget
 * opts in with `settings={{ conexao: <WidgetConnectionPlaceholder /> }}`.
 */
export function WidgetConnectionPlaceholder(): JSX.Element {
  const id = useId();
  return (
    <SettingsSection title={strings.widgetSettings.connectionTitle} description={strings.widgetSettings.connectionHint}>
      <SettingsRow label={strings.widgetSettings.connectionTitle} htmlFor={id} badge={<DevBadge />} stacked>
        <select id={id} className="eve-input" disabled defaultValue="">
          <option value="">{strings.widgetSettings.connectionPlaceholder}</option>
        </select>
      </SettingsRow>
    </SettingsSection>
  );
}
