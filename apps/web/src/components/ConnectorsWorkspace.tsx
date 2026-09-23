'use client';

import { Plug, strings } from '@eve/ui';
import { useCallback, useEffect, useState, type JSX } from 'react';
import type { AvailableConnector } from './DashboardShell';
import { isTeamConnector } from '../lib/connector-scope';
import { ConnectorSetup } from './ConnectorSetup';
import { useEscapeToClose } from './useEscapeToClose';

interface InstanceRow {
  id: string;
  connectorId: string;
  label: string;
  status: 'ok' | 'syncing' | 'error' | 'disabled';
  statusMessage?: string | null;
  lastSyncedAt: string | null;
}

interface ConnectorCatalogEntry extends AvailableConnector {
  category: 'external' | 'local';
  auth: 'oauth2' | 'api_key' | 'token' | 'webhook' | 'none';
  capabilities: { read: boolean; write: boolean; webhook: boolean };
}

export interface ConnectorsWorkspaceProps {
  isOwner: boolean;
  /** 'team' = only the team's own connectors (the Equipe page); default = every outside service. */
  scope?: 'team';
}

const STATUS_LABEL: Record<InstanceRow['status'], string> = {
  ok: 'Conectado',
  syncing: 'Sincronizando...',
  error: 'Erro',
  disabled: 'Desativado',
};

function formatLastSynced(value: string | null): string {
  if (!value) return 'nunca sincronizado';
  return new Date(value).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

/**
 * One place to see and manage every connector — available types and the
 * workspace's current instances of each — instead of the previous only
 * entry point (the dashboard's Ctrl+K "add widget" palette), which was easy
 * to miss and showed nothing about connections that already exist.
 */
export function ConnectorsWorkspace({ isOwner, scope }: ConnectorsWorkspaceProps): JSX.Element {
  const [available, setAvailable] = useState<ConnectorCatalogEntry[]>([]);
  const [instances, setInstances] = useState<InstanceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [setupConnector, setSetupConnector] = useState<ConnectorCatalogEntry | null>(null);
  const [expandedConnector, setExpandedConnector] = useState<ConnectorCatalogEntry | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  // Why "Conectar com Google" came back without connecting (?googleAgenda=, set by its OAuth routes).
  const [googleNotice, setGoogleNotice] = useState<string | null>(null);

  useEffect(() => {
    // Mount-time read of the URL, an external system like localStorage in SideRail.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setGoogleNotice(new URLSearchParams(window.location.search).get('googleAgenda'));
  }, []);

  useEscapeToClose(() => setExpandedConnector(null));

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/instances', { cache: 'no-store' });
      const body = (await response.json().catch(() => ({}))) as {
        instances?: InstanceRow[];
        available?: ConnectorCatalogEntry[];
        error?: string;
      };
      if (!response.ok || !body.available) {
        setError(body.error ?? `HTTP ${response.status}`);
        return;
      }
      // This page is about real outside connections (Notion, Meta, Claude) —
      // local widgets with nothing to "connect" (Calculator, Notes, Calendar,
      // Demo) stay reachable from the dashboard's own add-widget palette.
      // On Equipe, only the team's own tools: the clients' social media is connected on each client page.
      const shown = body.available.filter((connector) => (scope === 'team' ? isTeamConnector(connector) : connector.category === 'external'));
      setAvailable(shown);
      setInstances((body.instances ?? []).filter((instance) => shown.some((connector) => connector.id === instance.connectorId)));
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  }, [scope]);

  useEffect(() => {
    // Mount fetch — same legitimate case as useWidgetData.ts's initial fetch.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const connectWithoutCredentials = async (connector: ConnectorCatalogEntry) => {
    setBusyId(connector.id);
    setError(null);
    try {
      const response = await fetch('/api/instances', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ connectorId: connector.id, label: connector.label }),
      });
      const body = (await response.json().catch(() => ({}))) as { instance?: InstanceRow; error?: string };
      if (!response.ok || !body.instance) {
        setError(body.error ?? `HTTP ${response.status}`);
        return;
      }
      setInstances((current) => [...current, body.instance!]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusyId(null);
    }
  };

  const syncNow = async (instanceId: string) => {
    setBusyId(instanceId);
    setError(null);
    try {
      const response = await fetch(`/api/instances/${instanceId}/sync`, { method: 'POST' });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        setError(body.error ?? `HTTP ${response.status}`);
        return;
      }
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusyId(null);
    }
  };

  const disconnect = async (instanceId: string) => {
    setBusyId(instanceId);
    setError(null);
    try {
      const response = await fetch(`/api/instances/${instanceId}`, { method: 'DELETE' });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        setError(body.error ?? `HTTP ${response.status}`);
        return;
      }
      setInstances((current) => current.filter((instance) => instance.id !== instanceId));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="eve-connectors">
      {googleNotice && <p className="eve-alert eve-alert--error">Google Agenda: {googleNotice}</p>}
      {error && <p className="eve-alert eve-alert--error">{error}</p>}

      {loading ? (
        <p className="eve-dim">carregando...</p>
      ) : (
        <div className="eve-connectors__grid">
          {available.map((connector) => {
            const connectorInstances = instances.filter((instance) => instance.connectorId === connector.id);
            return (
              <div key={connector.id} className="eve-connectors__card">
                <button
                  type="button"
                  className="eve-connectors__card-head"
                  onClick={() => setExpandedConnector(connector)}
                  aria-label={`Ver detalhes de ${connector.label}`}
                >
                  <span className="eve-connectors__socket" aria-hidden="true">
                    <SocketIcon />
                  </span>
                  <div>
                    <strong>{connector.label}</strong>
                    {connector.description && <p className="eve-dim eve-connectors__description">{connector.description}</p>}
                  </div>
                </button>

                {connectorInstances.length > 0 && (
                  <ul className="eve-connectors__instances">
                    {connectorInstances.map((instance) => (
                      <li key={instance.id} className="eve-connectors__instance">
                        <span className={`eve-connectors__status is-${instance.status}`}>{STATUS_LABEL[instance.status]}</span>
                        <span className="eve-connectors__instance-label">{instance.label}</span>
                        <span className="eve-dim">{formatLastSynced(instance.lastSyncedAt)}</span>
                        {instance.statusMessage && <span className="eve-dim eve-connectors__error-msg">{instance.statusMessage}</span>}
                        <div className="eve-connectors__instance-actions">
                          <button
                            type="button"
                            className="eve-btn"
                            disabled={busyId === instance.id}
                            onClick={() => void syncNow(instance.id)}
                          >
                            Sincronizar
                          </button>
                          {isOwner && (
                            <button
                              type="button"
                              className="eve-btn eve-btn--danger"
                              disabled={busyId === instance.id}
                              onClick={() => void disconnect(instance.id)}
                            >
                              Desconectar
                            </button>
                          )}
                        </div>
                      </li>
                    ))}
                  </ul>
                )}

                {connector.canCreate && (
                  <button
                    type="button"
                    className="eve-btn eve-btn--primary"
                    disabled={busyId === connector.id}
                    onClick={() =>
                      connector.needsCredentials ? setSetupConnector(connector) : void connectWithoutCredentials(connector)
                    }
                  >
                    {connectorInstances.length > 0 ? '+ Nova conexão' : 'Conectar'}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}

      {expandedConnector && (
        <div className="eve-modal-backdrop" onClick={() => setExpandedConnector(null)}>
          <div className="eve-modal eve-connectors__detail" onClick={(event) => event.stopPropagation()}>
            <div className="eve-connectors__card-head">
              <span className="eve-connectors__socket" aria-hidden="true">
                <SocketIcon />
              </span>
              <strong>{expandedConnector.label}</strong>
            </div>
            {expandedConnector.description && <p className="eve-dim">{expandedConnector.description}</p>}
            <button type="button" className="eve-btn" onClick={() => setExpandedConnector(null)}>
              Fechar
            </button>
          </div>
        </div>
      )}

      {setupConnector && (
        <div className="eve-modal-backdrop" onClick={() => setSetupConnector(null)}>
          <div className="eve-modal" onClick={(event) => event.stopPropagation()}>
            <ConnectorSetup
              connector={setupConnector}
              onCancel={() => setSetupConnector(null)}
              onConnected={(instance) => {
                setSetupConnector(null);
                setInstances((current) => [
                  ...current,
                  { ...instance, status: 'ok', statusMessage: null, lastSyncedAt: null },
                ]);
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
}

function SocketIcon(): JSX.Element {
  return <Plug size={20} aria-hidden="true" />;
}
