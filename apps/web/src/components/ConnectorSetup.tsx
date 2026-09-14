'use client';

import { strings } from '@eve/ui';
import { useState, type FormEvent, type JSX } from 'react';
import type { AvailableConnector } from './DashboardShell';

export interface ConnectorSetupProps {
  connector: AvailableConnector;
  onCancel: () => void;
  onConnected: (instance: { id: string; connectorId: string; label: string }) => void;
}

/**
 * Formulario de conexao para connectors que exigem credencial.
 *
 * Cada connector com `needsCredentials` tem seu proprio bloco de campos
 * abaixo, escolhido por `connector.id` — o SDK ainda nao declara os campos
 * de credencial de forma generica, entao isto continua sendo um switch
 * manual em vez de um formulario derivado de schema.
 */
export function ConnectorSetup({ connector, onCancel, onConnected }: ConnectorSetupProps): JSX.Element {
  // Notion
  const [token, setToken] = useState('');
  const [database, setDatabase] = useState('');
  // Meta
  const [pageId, setPageId] = useState('');
  const [igAccountId, setIgAccountId] = useState('');
  const [pageAccessToken, setPageAccessToken] = useState('');

  const [label, setLabel] = useState(connector.label);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isMeta = connector.id === 'meta';

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setError(null);

    const payload = isMeta
      ? {
          connectorId: connector.id,
          label,
          config: { pageId, instagramBusinessAccountId: igAccountId || undefined },
          credentials: { pageAccessToken },
        }
      : {
          connectorId: connector.id,
          label,
          config: { databaseId: database, visibleProperties: [] },
          credentials: { token },
        };

    try {
      const response = await fetch('/api/instances', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
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
          &larr;
        </button>
        <strong>{connector.label}</strong>
      </div>

      {error && <p className="eve-alert eve-alert--error">{error}</p>}

      {isMeta ? (
        <>
          <label className="eve-field">
            <span className="eve-field__label">{strings.meta.pageId}</span>
            <input className="eve-input" required value={pageId} onChange={(event) => setPageId(event.target.value)} />
            <span className="eve-setup__hint">{strings.meta.pageIdHint}</span>
          </label>

          <label className="eve-field">
            <span className="eve-field__label">{strings.meta.igAccountId}</span>
            <input className="eve-input" value={igAccountId} onChange={(event) => setIgAccountId(event.target.value)} />
            <span className="eve-setup__hint">{strings.meta.igAccountIdHint}</span>
          </label>

          <label className="eve-field">
            <span className="eve-field__label">{strings.meta.pageAccessToken}</span>
            <input
              className="eve-input"
              type="password"
              autoComplete="off"
              required
              value={pageAccessToken}
              onChange={(event) => setPageAccessToken(event.target.value)}
            />
            <span className="eve-setup__hint">{strings.meta.pageAccessTokenHint}</span>
          </label>
        </>
      ) : (
        <>
          <label className="eve-field">
            <span className="eve-field__label">{strings.notion.token}</span>
            <input
              className="eve-input"
              type="password"
              autoComplete="off"
              required
              value={token}
              onChange={(event) => setToken(event.target.value)}
            />
            <span className="eve-setup__hint">{strings.notion.tokenHint}</span>
          </label>

          <label className="eve-field">
            <span className="eve-field__label">{strings.notion.database}</span>
            <input
              className="eve-input"
              required
              value={database}
              placeholder="https://www.notion.so/..."
              onChange={(event) => setDatabase(event.target.value)}
            />
            <span className="eve-setup__hint">{strings.notion.databaseHint}</span>
          </label>
        </>
      )}

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
