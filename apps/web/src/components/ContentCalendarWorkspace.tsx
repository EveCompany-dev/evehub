'use client';

import { useEffect, useState, type JSX } from 'react';
import { DataTableGrid } from './DataTableGrid';
import { useSystemTable } from './useSystemTable';

interface ClientOption {
  id: string;
  label: string;
}

/**
 * Calendário de Conteúdo across every client: who is posting what, on which
 * channel and format, and whether it is an idea, in production or scheduled.
 * Pick a client to see only theirs; leave it on "Todos" to see the whole
 * agency. A quick look at what is already planned — just the calendar, no
 * "Nova": entries are added in the table (Tabelas, or Postagens on the client
 * page) and open here as a page with channel, status, format, date and link.
 */
export function ContentCalendarWorkspace(): JSX.Element {
  const { table, setTable, error } = useSystemTable('content');
  const [clients, setClients] = useState<ClientOption[]>([]);
  const [clientId, setClientId] = useState('');

  useEffect(() => {
    void (async () => {
      try {
        const response = await fetch('/api/scheduling/clients', { cache: 'no-store' });
        const body = (await response.json().catch(() => ({}))) as { clients?: { source: string; id: string; label: string }[] };
        if (response.ok && body.clients) {
          setClients(body.clients.filter((client) => client.source === 'local').map((client) => ({ id: client.id, label: client.label })));
        }
      } catch {
        // The selector just stays on "Todos os clientes".
      }
    })();
  }, []);

  if (error) return <p className="eve-alert eve-alert--error">{error}</p>;
  if (!table) return <p className="eve-dim">carregando...</p>;

  return (
    <div className="eve-contentcal">
      <div className="eve-contentcal__head">
        <select className="eve-input eve-contentcal__client" value={clientId} aria-label="Cliente" onChange={(event) => setClientId(event.target.value)}>
          <option value="">Todos os clientes</option>
          {clients.map((client) => (
            <option key={client.id} value={client.id}>
              {client.label}
            </option>
          ))}
        </select>
      </div>
      <DataTableGrid
        table={table}
        onTableChange={setTable}
        lockedClientId={clientId || undefined}
        modes={['calendar']}
        defaultMode="calendar"
        persistView={false}
      />
    </div>
  );
}
