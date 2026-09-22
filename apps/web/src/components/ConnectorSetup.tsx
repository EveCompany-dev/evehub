'use client';

import { DATE_RANGES, DATE_RANGE_LABELS } from '@eve/connector-google-ads/shared';
import { ChevronLeft, strings } from '@eve/ui';
import { useState, type FormEvent, type JSX } from 'react';
import type { AvailableConnector } from './DashboardShell';

export interface ConnectorSetupProps {
  connector: AvailableConnector;
  onCancel: () => void;
  onConnected: (instance: { id: string; connectorId: string; label: string }) => void;
  /** Attach the new connection to this client (set when opened from a client page). */
  clientId?: string;
}

interface SetupField {
  key: string;
  label: string;
  hint: string;
  /** Which half of the instance payload the value belongs to. */
  into: 'config' | 'credentials';
  required?: boolean;
  /** Rendered as a password input and never autofilled. */
  secret?: boolean;
  placeholder?: string;
  /** Sent as `undefined` rather than '' when left blank — optional upstream ids. */
  omitWhenEmpty?: boolean;
  /** Turns the field into a <select>. */
  options?: { value: string; label: string }[];
  defaultValue?: string;
}

/**
 * The connection form, one field list per connector.
 *
 * The SDK still doesn't describe credential fields generically (a Zod schema
 * says a string is required, not that it is a secret or how to get one), so
 * the shape lives here — but as data rather than a branch per connector, so
 * the next integration is a new entry and nothing else. A connector with no
 * entry just gets the name field.
 */
const SETUP_FIELDS: Record<string, SetupField[]> = {
  notion: [
    { key: 'token', label: strings.notion.token, hint: strings.notion.tokenHint, into: 'credentials', required: true, secret: true },
    {
      key: 'databaseId',
      label: strings.notion.database,
      hint: strings.notion.databaseHint,
      into: 'config',
      required: true,
      placeholder: 'https://www.notion.so/...',
    },
  ],

  meta: [
    { key: 'pageId', label: strings.meta.pageId, hint: strings.meta.pageIdHint, into: 'config', required: true },
    {
      key: 'instagramBusinessAccountId',
      label: strings.meta.igAccountId,
      hint: strings.meta.igAccountIdHint,
      into: 'config',
      omitWhenEmpty: true,
    },
    {
      key: 'pageAccessToken',
      label: strings.meta.pageAccessToken,
      hint: strings.meta.pageAccessTokenHint,
      into: 'credentials',
      required: true,
      secret: true,
    },
  ],

  'google-ads': [
    {
      key: 'customerId',
      label: strings.googleAds.customerId,
      hint: strings.googleAds.customerIdHint,
      into: 'config',
      required: true,
      placeholder: '123-456-7890',
    },
    {
      key: 'loginCustomerId',
      label: strings.googleAds.loginCustomerId,
      hint: strings.googleAds.loginCustomerIdHint,
      into: 'config',
      omitWhenEmpty: true,
    },
    {
      key: 'dateRange',
      label: strings.googleAds.dateRange,
      hint: strings.googleAds.dateRangeHint,
      into: 'config',
      defaultValue: 'LAST_30_DAYS',
      options: DATE_RANGES.map((range) => ({ value: range, label: DATE_RANGE_LABELS[range] })),
    },
    {
      key: 'developerToken',
      label: strings.googleAds.developerToken,
      hint: strings.googleAds.developerTokenHint,
      into: 'credentials',
      required: true,
      secret: true,
    },
    { key: 'clientId', label: strings.googleAds.clientId, hint: strings.googleAds.clientIdHint, into: 'credentials', required: true },
    {
      key: 'clientSecret',
      label: strings.googleAds.clientSecret,
      hint: strings.googleAds.clientSecretHint,
      into: 'credentials',
      required: true,
      secret: true,
    },
    {
      key: 'refreshToken',
      label: strings.googleAds.refreshToken,
      hint: strings.googleAds.refreshTokenHint,
      into: 'credentials',
      required: true,
      secret: true,
    },
  ],
};

/** Config the connector needs but nobody types — Notion's column filter starts empty. */
const EXTRA_CONFIG: Record<string, Record<string, unknown>> = {
  notion: { visibleProperties: [] },
};

function initialValues(fields: SetupField[]): Record<string, string> {
  return Object.fromEntries(fields.map((field) => [field.key, field.defaultValue ?? '']));
}

export function ConnectorSetup({ connector, onCancel, onConnected, clientId }: ConnectorSetupProps): JSX.Element {
  const fields = SETUP_FIELDS[connector.id] ?? [];

  const [values, setValues] = useState<Record<string, string>>(() => initialValues(fields));
  const [label, setLabel] = useState(connector.label);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const setValue = (key: string, value: string) => setValues((current) => ({ ...current, [key]: value }));

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setError(null);

    const config: Record<string, unknown> = { ...(EXTRA_CONFIG[connector.id] ?? {}) };
    const credentials: Record<string, unknown> = {};
    for (const field of fields) {
      const value = values[field.key] ?? '';
      if (field.omitWhenEmpty && value.trim() === '') continue;
      (field.into === 'config' ? config : credentials)[field.key] = value;
    }

    try {
      const response = await fetch('/api/instances', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ connectorId: connector.id, label, ...(clientId ? { clientId } : {}), config, credentials }),
      });

      const body = (await response.json().catch(() => ({}))) as {
        error?: string;
        instance?: { id: string; connectorId: string; label: string };
        firstSync?: { ok: boolean; error: string | null };
      };

      if (!response.ok || !body.instance) {
        setError(body.error ?? `HTTP ${response.status}`);
        return;
      }

      // A instancia foi criada mesmo se a primeira sync falhou — o widget ja
      // aparece mostrando o erro, que e mais util que esconder tudo.
      if (body.firstSync && !body.firstSync.ok) {
        setError(body.firstSync.error ?? 'A primeira sincronização falhou.');
        onConnected(body.instance);
        return;
      }

      onConnected(body.instance);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="eve-setup" onSubmit={(event) => void submit(event)}>
      <div className="eve-setup__head">
        <button type="button" className="eve-btn eve-btn--icon" onClick={onCancel} aria-label={strings.dock.back}>
          <ChevronLeft size={14} aria-hidden="true" />
        </button>
        <strong>{connector.label}</strong>
      </div>

      {error && <p className="eve-alert eve-alert--error">{error}</p>}

      {fields.map((field) => (
        <label className="eve-field" key={field.key}>
          <span className="eve-field__label">{field.label}</span>
          {field.options ? (
            <select className="eve-input" value={values[field.key] ?? ''} onChange={(event) => setValue(field.key, event.target.value)}>
              {field.options.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          ) : (
            <input
              className="eve-input"
              type={field.secret ? 'password' : 'text'}
              {...(field.secret ? { autoComplete: 'off' } : {})}
              {...(field.placeholder ? { placeholder: field.placeholder } : {})}
              required={field.required ?? false}
              value={values[field.key] ?? ''}
              onChange={(event) => setValue(field.key, event.target.value)}
            />
          )}
          <span className="eve-setup__hint">{field.hint}</span>
        </label>
      ))}

      <label className="eve-field">
        <span className="eve-field__label">Nome do widget</span>
        <input className="eve-input" required value={label} onChange={(event) => setLabel(event.target.value)} />
      </label>

      <button type="submit" className="eve-btn eve-btn--primary eve-btn--block" disabled={busy}>
        {busy ? strings.dock.connecting : strings.dock.connect}
      </button>
    </form>
  );
}
