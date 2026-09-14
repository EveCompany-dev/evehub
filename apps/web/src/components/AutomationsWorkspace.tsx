'use client';

import { strings } from '@eve/ui';
import { useCallback, useEffect, useState, type JSX } from 'react';

interface AutomationLogRow {
  id: string;
  source: string;
  event: string;
  payload: unknown;
  ok: boolean;
  createdAt: string;
}

export interface AutomationsWorkspaceProps {
  isOwner: boolean;
}

/**
 * Basic module: a public webhook endpoint (owner-managed token) that any
 * external service (n8n, etc.) can POST `{ source, event, payload?, ok? }`
 * to, plus a read-only activity feed of what came in. No workflow builder —
 * this is the ingestion + visibility layer the scaffold was missing.
 */
export function AutomationsWorkspace({ isOwner }: AutomationsWorkspaceProps): JSX.Element {
  const [logs, setLogs] = useState<AutomationLogRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [webhookToken, setWebhookToken] = useState<string | null>(null);
  const [tokenLoading, setTokenLoading] = useState(isOwner);
  const [origin, setOrigin] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const loadLogs = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/automations', { cache: 'no-store' });
      const body = (await response.json().catch(() => ({}))) as { logs?: AutomationLogRow[]; error?: string };
      if (!response.ok || !body.logs) {
        setError(body.error ?? `HTTP ${response.status}`);
        return;
      }
      setLogs(body.logs);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // Mount fetch — same legitimate case as useWidgetData.ts's initial fetch.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadLogs();
  }, [loadLogs]);

  useEffect(() => {
    // Mount-time read of an external system (window.location) — same
    // legitimate case as SideRail.tsx's localStorage read.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setOrigin(window.location.origin);
  }, []);

  useEffect(() => {
    if (!isOwner) return;
    void (async () => {
      try {
        const response = await fetch('/api/automations/webhook', { cache: 'no-store' });
        const body = (await response.json().catch(() => ({}))) as { webhookToken?: string | null };
        if (response.ok) setWebhookToken(body.webhookToken ?? null);
      } finally {
        setTokenLoading(false);
      }
    })();
  }, [isOwner]);

  const generateToken = async () => {
    setError(null);
    try {
      const response = await fetch('/api/automations/webhook', { method: 'POST' });
      const body = (await response.json().catch(() => ({}))) as { webhookToken?: string; error?: string };
      if (!response.ok || !body.webhookToken) {
        setError(body.error ?? `HTTP ${response.status}`);
        return;
      }
      setWebhookToken(body.webhookToken);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const disableToken = async () => {
    setError(null);
    try {
      const response = await fetch('/api/automations/webhook', { method: 'DELETE' });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        setError(body.error ?? `HTTP ${response.status}`);
        return;
      }
      setWebhookToken(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const webhookUrl = webhookToken ? `${origin}/api/webhooks/automations/${webhookToken}` : null;

  const copyUrl = async () => {
    if (!webhookUrl) return;
    try {
      await navigator.clipboard.writeText(webhookUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard API can be blocked (permissions/non-https) — the URL is still visible to select manually.
    }
  };

  return (
    <div className="eve-automations">
      {error && <p className="eve-alert eve-alert--error">{error}</p>}

      {isOwner && (
        <div className="eve-automations__webhook">
          <h2 className="eve-card__title">Webhook de automações</h2>
          <p className="eve-dim">Aponte o n8n (ou qualquer serviço) para esta URL com um POST {'{ source, event, payload?, ok? }'}.</p>
          {tokenLoading ? (
            <p className="eve-dim">carregando...</p>
          ) : webhookUrl ? (
            <div className="eve-automations__url-row">
              <code className="eve-automations__url">{webhookUrl}</code>
              <button type="button" className="eve-btn" onClick={() => void copyUrl()}>
                {copied ? 'Copiado!' : 'Copiar'}
              </button>
              <button type="button" className="eve-btn" onClick={() => void generateToken()}>
                Gerar novo link
              </button>
              <button type="button" className="eve-btn eve-btn--danger" onClick={() => void disableToken()}>
                Desativar
              </button>
            </div>
          ) : (
            <button type="button" className="eve-btn eve-btn--primary" onClick={() => void generateToken()}>
              Gerar link
            </button>
          )}
        </div>
      )}

      <h2 className="eve-card__title">Atividade recente</h2>
      {loading ? (
        <p className="eve-dim">carregando...</p>
      ) : logs.length === 0 ? (
        <div className="eve-empty">
          <p className="eve-dim">{strings.automations.empty}</p>
          <p className="eve-dim">{strings.automations.emptyHint}</p>
        </div>
      ) : (
        <ul className="eve-automations__list">
          {logs.map((log) => (
            <li key={log.id} className="eve-automations__item">
              <button
                type="button"
                className="eve-automations__item-head"
                onClick={() => setExpandedId((current) => (current === log.id ? null : log.id))}
              >
                <span className={log.ok ? 'eve-automations__badge is-ok' : 'eve-automations__badge is-fail'}>
                  {log.ok ? 'OK' : 'Falhou'}
                </span>
                <span className="eve-automations__source">{log.source}</span>
                <span className="eve-automations__event">{log.event}</span>
                <span className="eve-dim">{new Date(log.createdAt).toLocaleString('pt-BR')}</span>
              </button>
              {expandedId === log.id && <pre className="eve-automations__payload">{JSON.stringify(log.payload, null, 2)}</pre>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
