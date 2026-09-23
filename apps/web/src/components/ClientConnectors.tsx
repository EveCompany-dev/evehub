'use client';

import { Plug, Plus, Trash2 } from '@eve/ui';
import Link from 'next/link';
import { useCallback, useEffect, useState, type JSX } from 'react';
import { ConnectorSetup } from './ConnectorSetup';
import type { AvailableConnector } from './DashboardShell';
import { useEscapeToClose } from './useEscapeToClose';

interface InstanceRow {
  id: string;
  connectorId: string;
  label: string;
  status: 'ok' | 'syncing' | 'error' | 'disabled';
  statusMessage: string | null;
  lastSyncedAt: string | null;
}

const STATUS_LABEL: Record<InstanceRow['status'], { text: string; color: string }> = {
  ok: { text: 'ativo', color: 'green' },
  syncing: { text: 'sincronizando', color: 'blue' },
  error: { text: 'erro', color: 'red' },
  disabled: { text: 'desligado', color: 'gray' },
};

/** Outside services that belong to the team, never to one client. */
const TEAM_ONLY = new Set(['chat', 'google-calendar']);

export interface ConnectorPickerProps {
  clientId: string;
  available: AvailableConnector[];
  onConnected: () => void;
  onClose: () => void;
  /** Sentence under the title (used right after a client is created). */
  intro?: string;
  /** Label of the button that leaves without connecting. */
  closeLabel?: string;
}

/**
 * Pick a connector type and set it up for one client. Used from the client
 * page's Conectores section and right after a client is created. Connectors
 * that need no credential are created in one click; the rest open their
 * credential form.
 */
export function ConnectorPicker({ clientId, available, onConnected, onClose, intro, closeLabel = 'Fechar' }: ConnectorPickerProps): JSX.Element {
  const [chosen, setChosen] = useState<AvailableConnector | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEscapeToClose(onClose);

  const addWithoutCredentials = async (connector: AvailableConnector) => {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch('/api/instances', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ connectorId: connector.id, label: connector.label, clientId }),
      });
      const body = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) {
        setError(body.error ?? `HTTP ${response.status}`);
        return;
      }
      onConnected();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  // Only real outside services a client has (Meta, Google Ads, Notion): no local widgets like Demo
  // or Timer, and none of the team's own tools (the Claude assistant, the Google Agenda).
  const creatable = available.filter((connector) => connector.canCreate && connector.category === 'external' && !TEAM_ONLY.has(connector.id));

  return (
    <div className="eve-modal-backdrop" onClick={onClose}>
      <div className="eve-modal eve-connpicker" role="dialog" aria-label="Adicionar conector" onClick={(event) => event.stopPropagation()}>
        <h2 className="eve-card__title">Adicionar conector</h2>
        {intro && !chosen && <p className="eve-dim">{intro}</p>}
        {chosen ? (
          <ConnectorSetup connector={chosen} clientId={clientId} onCancel={() => setChosen(null)} onConnected={onConnected} />
        ) : (
          <>
            {error && <p className="eve-alert eve-alert--error">{error}</p>}
            {creatable.length === 0 ? (
              <p className="eve-dim">Nenhum conector disponível para o seu usuário. Peça a um owner para conectar.</p>
            ) : (
              <div className="eve-connpicker__list">
                {creatable.map((connector) => (
                  <button
                    key={connector.id}
                    type="button"
                    className="eve-connpicker__item"
                    disabled={busy}
                    onClick={() => (connector.needsCredentials ? setChosen(connector) : void addWithoutCredentials(connector))}
                  >
                    <Plug size={16} aria-hidden="true" />
                    <span>
                      <strong>{connector.label}</strong>
                      {connector.description && <span className="eve-dim eve-connpicker__desc">{connector.description}</span>}
                    </span>
                  </button>
                ))}
              </div>
            )}
            <div className="eve-profile__actions">
              <button type="button" className="eve-btn" onClick={onClose}>
                {closeLabel}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/** The client page's Conectores section: this client's connections, and the way to add one. */
export function ClientConnectors({ clientId }: { clientId: string }): JSX.Element {
  const [instances, setInstances] = useState<InstanceRow[] | null>(null);
  const [available, setAvailable] = useState<AvailableConnector[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const load = useCallback(async () => {
    try {
      const response = await fetch(`/api/instances?clientId=${encodeURIComponent(clientId)}`, { cache: 'no-store' });
      const body = (await response.json().catch(() => ({}))) as { instances?: InstanceRow[]; available?: AvailableConnector[]; error?: string };
      if (!response.ok || !body.instances) {
        setError(body.error ?? `HTTP ${response.status}`);
        return;
      }
      setInstances(body.instances);
      setAvailable(body.available ?? []);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, [clientId]);

  useEffect(() => {
    // Mount fetch — setState happens after an await.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const remove = async (instance: InstanceRow) => {
    if (!window.confirm(`Remover o conector “${instance.label}”? Os widgets que usam ele deixam de receber dados.`)) return;
    const response = await fetch(`/api/instances/${instance.id}`, { method: 'DELETE' });
    if (!response.ok) {
      const body = (await response.json().catch(() => ({}))) as { error?: string };
      setError(body.error ?? `HTTP ${response.status}`);
      return;
    }
    void load();
  };

  return (
    <>
      <div className="eve-clientpage__actions">
        <button type="button" className="eve-btn" onClick={() => setAdding(true)}>
          <Plus size={14} aria-hidden="true" /> Adicionar conector
        </button>
        <Link href="/connectors" className="eve-btn">
          Todos os conectores
        </Link>
      </div>
      {error && <p className="eve-alert eve-alert--error">{error}</p>}
      {!instances && !error && <p className="eve-dim">carregando...</p>}
      {instances && instances.length === 0 && <p className="eve-dim">Nenhum conector ligado a este cliente ainda.</p>}
      {instances && instances.length > 0 && (
        <ul className="eve-clientpage__joblist">
          {instances.map((instance) => (
            <li key={instance.id}>
              <Plug size={14} aria-hidden="true" />
              <span>{instance.label}</span>
              <span className="eve-dim">{instance.connectorId}</span>
              <span className="eve-pill" data-color={STATUS_LABEL[instance.status].color} title={instance.statusMessage ?? undefined}>
                <span className="eve-pill__text">{STATUS_LABEL[instance.status].text}</span>
              </span>
              {instance.lastSyncedAt && <span className="eve-dim">sincronizado {new Date(instance.lastSyncedAt).toLocaleString('pt-BR')}</span>}
              <button type="button" className="eve-btn eve-btn--icon eve-clientpage__end" aria-label={`Remover ${instance.label}`} onClick={() => void remove(instance)}>
                <Trash2 size={14} aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}
      {adding && (
        <ConnectorPicker
          clientId={clientId}
          available={available}
          onClose={() => setAdding(false)}
          onConnected={() => {
            setAdding(false);
            void load();
          }}
        />
      )}
    </>
  );
}
