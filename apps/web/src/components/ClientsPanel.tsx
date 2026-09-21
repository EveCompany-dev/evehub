'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState, type JSX } from 'react';
import { clientAccent, readableOn } from '../lib/table-tags';
import { ClientAvatar } from './TagPill';
import { ClientBrandEditor, type BrandClient } from './ClientBrandEditor';

interface ClientApiEntry {
  source: 'local' | 'notion';
  id: string;
  label: string;
  notes?: string | null;
  color?: string | null;
  icon?: string | null;
  logoUrl?: string | null;
}

function fold(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
}

/**
 * Every local agency client (the same `Client` model scheduling already
 * uses) as a gallery of brand cards — cover in the client's color with its
 * logo, name underneath — like the Notion "Marcas Atendidas" board this
 * replaces. A card opens the client's own page; the pencil edits its
 * identity (name, color, logo, emoji, notes). Notion-sourced clients show
 * up in scheduling's picker but not here — they aren't local rows this
 * screen can edit or delete.
 */
export function ClientsPanel(): JSX.Element {
  const [clients, setClients] = useState<BrandClient[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<BrandClient | 'new' | null>(null);
  const [query, setQuery] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/scheduling/clients', { cache: 'no-store' });
      const body = (await response.json().catch(() => ({}))) as { clients?: ClientApiEntry[]; error?: string };
      if (!response.ok || !body.clients) {
        setError(body.error ?? `HTTP ${response.status}`);
        return;
      }
      setClients(
        body.clients
          .filter((client) => client.source === 'local')
          .map((client) => ({
            id: client.id,
            name: client.label,
            notes: client.notes ?? null,
            color: client.color ?? null,
            icon: client.icon ?? null,
            logoUrl: client.logoUrl ?? null,
          })),
      );
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
    void load();
  }, [load]);

  const shown = useMemo(() => {
    const needle = fold(query.trim());
    return needle ? clients.filter((client) => fold(`${client.name} ${client.notes ?? ''}`).includes(needle)) : clients;
  }, [clients, query]);

  const saved = (client: BrandClient) => {
    setClients((current) => {
      const exists = current.some((item) => item.id === client.id);
      const next = exists ? current.map((item) => (item.id === client.id ? client : item)) : [...current, client];
      return next.sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
    });
    setEditing(null);
  };

  return (
    <div className="eve-clients">
      {error && <p className="eve-alert eve-alert--error">{error}</p>}

      <div className="eve-clients__head">
        <button type="button" className="eve-btn eve-btn--primary" onClick={() => setEditing('new')}>
          + Novo cliente
        </button>
        <input
          className="eve-input eve-toolbar__search"
          type="search"
          placeholder="Buscar cliente…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <span className="eve-dim">{clients.length} cliente{clients.length === 1 ? '' : 's'}</span>
      </div>

      {loading ? (
        <p className="eve-dim">carregando...</p>
      ) : clients.length === 0 ? (
        <div className="eve-empty">
          <p className="eve-dim">Nenhum cliente ainda. Use o botão acima para cadastrar o primeiro — ou importe um CSV com uma coluna “Cliente”.</p>
        </div>
      ) : (
        <div className="eve-gallery eve-gallery--clients">
          {shown.map((client) => {
            const accent = clientAccent(client.name, client.color);
            return (
              <div key={client.id} className="eve-gallery__card eve-gallery__card--client">
                <Link href={`/clients/${client.id}`} className="eve-gallery__cardlink" aria-label={`Abrir ${client.name}`}>
                  <div className="eve-gallery__cover" style={{ background: accent, color: readableOn(accent) }}>
                    {client.logoUrl || client.icon ? <ClientAvatar client={{ label: client.name, ...client }} size={64} /> : <span className="eve-gallery__initial">{client.name.charAt(0).toUpperCase()}</span>}
                  </div>
                  <div className="eve-gallery__body">
                    <strong className="eve-gallery__title">
                      {client.logoUrl && client.icon ? `${client.icon} ` : ''}
                      {client.name}
                    </strong>
                    {client.notes && <span className="eve-dim eve-gallery__notes">{client.notes}</span>}
                  </div>
                </Link>
                <button type="button" className="eve-btn eve-btn--icon eve-gallery__edit" aria-label={`Editar ${client.name}`} onClick={() => setEditing(client)}>
                  ✎
                </button>
              </div>
            );
          })}
          {shown.length === 0 && <p className="eve-dim eve-gallery__empty">Nenhum cliente com esse nome.</p>}
        </div>
      )}

      {editing && (
        <ClientBrandEditor
          client={editing === 'new' ? undefined : editing}
          onSaved={saved}
          onDeleted={(id) => {
            setClients((current) => current.filter((client) => client.id !== id));
            setEditing(null);
          }}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}
