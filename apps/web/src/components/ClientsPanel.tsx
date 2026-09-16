'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState, type JSX } from 'react';

interface ClientRow {
  id: string;
  name: string;
  notes: string | null;
}

interface ClientApiEntry {
  source: 'local' | 'notion';
  id: string;
  label: string;
  notes?: string | null;
}

/**
 * Lists every local agency client (the same `Client` model scheduling
 * already uses) so Tabelas has a real, editable client registry instead of
 * a picker buried inside the scheduling composer. Notion-sourced clients
 * show up in scheduling's picker but not here — they aren't local rows
 * this screen can edit or delete.
 */
export function ClientsPanel(): JSX.Element {
  const [clients, setClients] = useState<ClientRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [newNotes, setNewNotes] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editNotes, setEditNotes] = useState('');

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
          .map((client) => ({ id: client.id, name: client.label, notes: client.notes ?? null })),
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

  const createClient = async () => {
    if (!newName.trim()) return;
    setError(null);
    try {
      const response = await fetch('/api/scheduling/clients', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newName.trim(), notes: newNotes.trim() || undefined }),
      });
      const body = (await response.json().catch(() => ({}))) as {
        client?: { id: string; name: string; notes: string | null };
        error?: string;
      };
      if (!response.ok || !body.client) {
        setError(body.error ?? `HTTP ${response.status}`);
        return;
      }
      const client = body.client;
      setClients((current) => [...current, client].sort((a, b) => a.name.localeCompare(b.name)));
      setNewName('');
      setNewNotes('');
      setCreating(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const startEdit = (client: ClientRow) => {
    setEditingId(client.id);
    setEditName(client.name);
    setEditNotes(client.notes ?? '');
  };

  const saveEdit = async () => {
    if (!editingId || !editName.trim()) return;
    setError(null);
    try {
      const response = await fetch(`/api/scheduling/clients/${editingId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: editName.trim(), notes: editNotes.trim() || null }),
      });
      const body = (await response.json().catch(() => ({}))) as {
        client?: { id: string; name: string; notes: string | null };
        error?: string;
      };
      if (!response.ok || !body.client) {
        setError(body.error ?? `HTTP ${response.status}`);
        return;
      }
      const updated = body.client;
      setClients((current) => current.map((client) => (client.id === editingId ? updated : client)));
      setEditingId(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const deleteClient = async (id: string) => {
    setError(null);
    try {
      const response = await fetch(`/api/scheduling/clients/${id}`, { method: 'DELETE' });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        setError(body.error ?? `HTTP ${response.status}`);
        return;
      }
      setClients((current) => current.filter((client) => client.id !== id));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  return (
    <div className="eve-clients">
      {error && <p className="eve-alert eve-alert--error">{error}</p>}

      <div className="eve-clients__head">
        {creating ? (
          <span className="eve-tables__new">
            <input
              className="eve-input"
              autoFocus
              placeholder="Nome do cliente"
              value={newName}
              onChange={(event) => setNewName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') void createClient();
                if (event.key === 'Escape') setCreating(false);
              }}
            />
            <input
              className="eve-input"
              placeholder="Notas (opcional)"
              value={newNotes}
              onChange={(event) => setNewNotes(event.target.value)}
            />
            <button type="button" className="eve-btn eve-btn--primary" onClick={() => void createClient()}>
              Criar
            </button>
            <button type="button" className="eve-btn" onClick={() => setCreating(false)}>
              Cancelar
            </button>
          </span>
        ) : (
          <button type="button" className="eve-btn eve-btn--primary" onClick={() => setCreating(true)}>
            + Novo cliente
          </button>
        )}
      </div>

      {loading ? (
        <p className="eve-dim">carregando...</p>
      ) : clients.length === 0 ? (
        <div className="eve-empty">
          <p className="eve-dim">Nenhum cliente ainda. Use o botão acima para cadastrar o primeiro.</p>
        </div>
      ) : (
        <div className="eve-table-wrap">
          <table className="eve-table">
            <thead>
              <tr>
                <th>Nome</th>
                <th>Notas</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {clients.map((client) => (
                <tr key={client.id}>
                  {editingId === client.id ? (
                    <>
                      <td>
                        <input
                          className="eve-input"
                          autoFocus
                          value={editName}
                          onChange={(event) => setEditName(event.target.value)}
                        />
                      </td>
                      <td>
                        <input className="eve-input" value={editNotes} onChange={(event) => setEditNotes(event.target.value)} />
                      </td>
                      <td>
                        <button type="button" className="eve-btn eve-btn--primary" onClick={() => void saveEdit()}>
                          Salvar
                        </button>
                        <button type="button" className="eve-btn" onClick={() => setEditingId(null)}>
                          Cancelar
                        </button>
                      </td>
                    </>
                  ) : (
                    <>
                      <td>
                        <Link href={`/clients/${client.id}`}>{client.name}</Link>
                      </td>
                      <td className="eve-dim">{client.notes || '—'}</td>
                      <td>
                        <button type="button" className="eve-btn eve-btn--icon" aria-label="Editar" onClick={() => startEdit(client)}>
                          ✎
                        </button>
                        <button
                          type="button"
                          className="eve-btn eve-btn--icon"
                          aria-label="Apagar"
                          onClick={() => void deleteClient(client.id)}
                        >
                          🗑
                        </button>
                      </td>
                    </>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
