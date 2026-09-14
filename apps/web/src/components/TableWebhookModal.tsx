'use client';

import { useState, type JSX } from 'react';
import type { DataTableSummary } from './data-table-types';
import { useEscapeToClose } from './useEscapeToClose';

export interface TableWebhookModalProps {
  table: DataTableSummary;
  onTableChange: (table: DataTableSummary) => void;
  onClose: () => void;
}

/**
 * Only mounts client-side on demand (never part of the initial server-rendered
 * tree), so reading window.location here in render is safe — no SSR pass ever
 * sees this component.
 */
export function TableWebhookModal({ table, onTableChange, onClose }: TableWebhookModalProps): JSX.Element {
  useEscapeToClose(onClose);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const url = table.webhookToken ? `${window.location.origin}/api/webhooks/tables/${table.webhookToken}` : null;

  const generate = async () => {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/tables/${table.id}/webhook`, { method: 'POST' });
      const body = (await response.json().catch(() => ({}))) as { webhookToken?: string; error?: string };
      if (!response.ok) {
        setError(body.error ?? `HTTP ${response.status}`);
        return;
      }
      onTableChange({ ...table, webhookToken: body.webhookToken ?? null });
    } finally {
      setBusy(false);
    }
  };

  const disable = async () => {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/tables/${table.id}/webhook`, { method: 'DELETE' });
      if (response.ok) onTableChange({ ...table, webhookToken: null });
    } finally {
      setBusy(false);
    }
  };

  const setKeyColumn = async (webhookKeyColumn: string) => {
    setError(null);
    try {
      const response = await fetch(`/api/tables/${table.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ webhookKeyColumn: webhookKeyColumn || null }),
      });
      const body = (await response.json().catch(() => ({}))) as { table?: DataTableSummary; error?: string };
      if (!response.ok || !body.table) {
        setError(body.error ?? `HTTP ${response.status}`);
        return;
      }
      onTableChange(body.table);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const copy = async () => {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard permission denied or unavailable — the URL is still
      // selectable text in the input, so this isn't a dead end.
    }
  };

  return (
    <div className="eve-modal-backdrop" onClick={onClose}>
      <div className="eve-modal" onClick={(event) => event.stopPropagation()}>
        <h2 className="eve-card__title">Automação por webhook</h2>
        <p className="eve-dim">
          Um POST enviado para o link abaixo cria ou atualiza uma linha, mapeando cada chave do JSON para uma coluna
          desta tabela. Chaves desconhecidas são ignoradas.
        </p>

        {error && <p className="eve-alert eve-alert--error">{error}</p>}

        {url ? (
          <label className="eve-field">
            <span className="eve-field__label">URL do webhook</span>
            <span className="eve-editbar__actions">
              <input className="eve-input" readOnly value={url} onFocus={(event) => event.target.select()} />
              <button type="button" className="eve-btn" onClick={() => void copy()}>
                {copied ? 'Copiado!' : 'Copiar'}
              </button>
            </span>
          </label>
        ) : (
          <p className="eve-dim">Nenhum link gerado ainda.</p>
        )}

        <label className="eve-field">
          <span className="eve-field__label">Coluna usada para casar linhas</span>
          <select
            className="eve-input"
            value={table.webhookKeyColumn ?? ''}
            onChange={(event) => void setKeyColumn(event.target.value)}
          >
            <option value="">Nenhuma — todo POST cria uma linha nova</option>
            {table.columns.map((column) => (
              <option key={column.key} value={column.key}>
                {column.label}
              </option>
            ))}
          </select>
        </label>

        <div className="eve-profile__actions">
          <button type="button" className="eve-btn eve-btn--primary" disabled={busy} onClick={() => void generate()}>
            {table.webhookToken ? 'Gerar novo link' : 'Gerar link'}
          </button>
          {table.webhookToken && (
            <button type="button" className="eve-btn eve-btn--danger" disabled={busy} onClick={() => void disable()}>
              Desativar
            </button>
          )}
          <button type="button" className="eve-btn" onClick={onClose}>
            Fechar
          </button>
        </div>
      </div>
    </div>
  );
}
