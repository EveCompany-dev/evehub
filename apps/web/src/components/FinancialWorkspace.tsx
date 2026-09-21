'use client';

import { Pencil, strings, Trash2 } from '@eve/ui';
import { useCallback, useEffect, useState, type JSX } from 'react';

interface FinancialEntryRow {
  id: string;
  type: 'income' | 'expense';
  description: string;
  amountCents: number;
  date: string;
  client: { id: string; name: string } | null;
  job: { id: string; title: string } | null;
}

interface PickerOption {
  id: string;
  label: string;
}

function formatCentsBRL(cents: number): string {
  return (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function todayInputValue(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Basic manual ledger: entries typed in by hand, optionally tagged to a
 * local client and/or job. No bank/gateway integration — that's a much
 * bigger, separate project. `amountCents` avoids float rounding on money.
 */
export function FinancialWorkspace(): JSX.Element {
  const [entries, setEntries] = useState<FinancialEntryRow[]>([]);
  const [clients, setClients] = useState<PickerOption[]>([]);
  const [jobs, setJobs] = useState<PickerOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const [formType, setFormType] = useState<'income' | 'expense'>('income');
  const [formDescription, setFormDescription] = useState('');
  const [formAmount, setFormAmount] = useState('');
  const [formDate, setFormDate] = useState(todayInputValue());
  const [formClientId, setFormClientId] = useState('');
  const [formJobId, setFormJobId] = useState('');

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDescription, setEditDescription] = useState('');
  const [editAmount, setEditAmount] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/financial/entries', { cache: 'no-store' });
      const body = (await response.json().catch(() => ({}))) as { entries?: FinancialEntryRow[]; error?: string };
      if (!response.ok || !body.entries) {
        setError(body.error ?? `HTTP ${response.status}`);
        return;
      }
      setEntries(body.entries);
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

  useEffect(() => {
    void (async () => {
      try {
        const [clientsResponse, jobsResponse] = await Promise.all([
          fetch('/api/scheduling/clients', { cache: 'no-store' }),
          fetch('/api/jobs', { cache: 'no-store' }),
        ]);
        const clientsBody = (await clientsResponse.json().catch(() => ({}))) as {
          clients?: { source: string; id: string; label: string }[];
        };
        if (clientsResponse.ok && clientsBody.clients) {
          setClients(clientsBody.clients.filter((client) => client.source === 'local').map((client) => ({ id: client.id, label: client.label })));
        }
        const jobsBody = (await jobsResponse.json().catch(() => ({}))) as { jobs?: { id: string; title: string }[] };
        if (jobsResponse.ok && jobsBody.jobs) {
          setJobs(jobsBody.jobs.map((job) => ({ id: job.id, label: job.title })));
        }
      } catch {
        // Non-critical: the pickers just stay empty — entries can still be created without a client/job link.
      }
    })();
  }, []);

  const resetForm = () => {
    setFormType('income');
    setFormDescription('');
    setFormAmount('');
    setFormDate(todayInputValue());
    setFormClientId('');
    setFormJobId('');
  };

  const createEntry = async () => {
    const amount = Number(formAmount.replace(',', '.'));
    if (!formDescription.trim() || !Number.isFinite(amount) || amount <= 0) return;
    setError(null);
    try {
      const response = await fetch('/api/financial/entries', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: formType,
          description: formDescription.trim(),
          amountCents: Math.round(amount * 100),
          date: new Date(formDate).toISOString(),
          clientId: formClientId || undefined,
          jobId: formJobId || undefined,
        }),
      });
      const body = (await response.json().catch(() => ({}))) as { entry?: FinancialEntryRow; error?: string };
      if (!response.ok || !body.entry) {
        setError(body.error ?? `HTTP ${response.status}`);
        return;
      }
      const entry = body.entry;
      setEntries((current) => [entry, ...current]);
      resetForm();
      setCreating(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const startEdit = (entry: FinancialEntryRow) => {
    setEditingId(entry.id);
    setEditDescription(entry.description);
    setEditAmount((entry.amountCents / 100).toString());
  };

  const saveEdit = async () => {
    if (!editingId) return;
    const amount = Number(editAmount.replace(',', '.'));
    if (!editDescription.trim() || !Number.isFinite(amount) || amount <= 0) return;
    setError(null);
    try {
      const response = await fetch(`/api/financial/entries/${editingId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description: editDescription.trim(), amountCents: Math.round(amount * 100) }),
      });
      const body = (await response.json().catch(() => ({}))) as { entry?: FinancialEntryRow; error?: string };
      if (!response.ok || !body.entry) {
        setError(body.error ?? `HTTP ${response.status}`);
        return;
      }
      const updated = body.entry;
      setEntries((current) => current.map((entry) => (entry.id === editingId ? updated : entry)));
      setEditingId(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const deleteEntry = async (id: string) => {
    setError(null);
    try {
      const response = await fetch(`/api/financial/entries/${id}`, { method: 'DELETE' });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        setError(body.error ?? `HTTP ${response.status}`);
        return;
      }
      setEntries((current) => current.filter((entry) => entry.id !== id));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const totalIncome = entries.filter((entry) => entry.type === 'income').reduce((sum, entry) => sum + entry.amountCents, 0);
  const totalExpense = entries.filter((entry) => entry.type === 'expense').reduce((sum, entry) => sum + entry.amountCents, 0);
  const balance = totalIncome - totalExpense;

  return (
    <div className="eve-financial">
      {error && <p className="eve-alert eve-alert--error">{error}</p>}

      <div className="eve-financial__summary">
        <div className="eve-financial__stat">
          <span className="eve-dim">Entradas</span>
          <strong className="eve-financial__stat-value is-income">{formatCentsBRL(totalIncome)}</strong>
        </div>
        <div className="eve-financial__stat">
          <span className="eve-dim">Saídas</span>
          <strong className="eve-financial__stat-value is-expense">{formatCentsBRL(totalExpense)}</strong>
        </div>
        <div className="eve-financial__stat">
          <span className="eve-dim">Saldo</span>
          <strong className={balance >= 0 ? 'eve-financial__stat-value is-income' : 'eve-financial__stat-value is-expense'}>
            {formatCentsBRL(balance)}
          </strong>
        </div>
      </div>

      <div className="eve-financial__head">
        {creating ? (
          <div className="eve-financial__form">
            <select className="eve-input" value={formType} onChange={(event) => setFormType(event.target.value as 'income' | 'expense')}>
              <option value="income">Entrada</option>
              <option value="expense">Saída</option>
            </select>
            <input
              className="eve-input"
              placeholder="Descrição"
              autoFocus
              value={formDescription}
              onChange={(event) => setFormDescription(event.target.value)}
            />
            <input
              className="eve-input"
              placeholder="Valor (R$)"
              inputMode="decimal"
              value={formAmount}
              onChange={(event) => setFormAmount(event.target.value)}
            />
            <input className="eve-input" type="date" value={formDate} onChange={(event) => setFormDate(event.target.value)} />
            <select className="eve-input" value={formClientId} onChange={(event) => setFormClientId(event.target.value)}>
              <option value="">Sem cliente</option>
              {clients.map((client) => (
                <option key={client.id} value={client.id}>
                  {client.label}
                </option>
              ))}
            </select>
            <select className="eve-input" value={formJobId} onChange={(event) => setFormJobId(event.target.value)}>
              <option value="">Sem job</option>
              {jobs.map((job) => (
                <option key={job.id} value={job.id}>
                  {job.label}
                </option>
              ))}
            </select>
            <button type="button" className="eve-btn eve-btn--primary" onClick={() => void createEntry()}>
              Salvar
            </button>
            <button
              type="button"
              className="eve-btn"
              onClick={() => {
                resetForm();
                setCreating(false);
              }}
            >
              Cancelar
            </button>
          </div>
        ) : (
          <button type="button" className="eve-btn eve-btn--primary" onClick={() => setCreating(true)}>
            + Novo lançamento
          </button>
        )}
      </div>

      {loading ? (
        <p className="eve-dim">carregando...</p>
      ) : entries.length === 0 ? (
        <div className="eve-empty">
          <p className="eve-dim">{strings.financial.empty}</p>
          <p className="eve-dim">{strings.financial.emptyHint}</p>
        </div>
      ) : (
        <div className="eve-table-wrap">
          <table className="eve-table">
            <thead>
              <tr>
                <th>Data</th>
                <th>Descrição</th>
                <th>Cliente</th>
                <th>Job</th>
                <th>Valor</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => (
                <tr key={entry.id}>
                  <td>{new Date(entry.date).toLocaleDateString('pt-BR')}</td>
                  {editingId === entry.id ? (
                    <>
                      <td>
                        <input
                          className="eve-input"
                          autoFocus
                          value={editDescription}
                          onChange={(event) => setEditDescription(event.target.value)}
                        />
                      </td>
                      <td className="eve-dim">{entry.client?.name ?? '—'}</td>
                      <td className="eve-dim">{entry.job?.title ?? '—'}</td>
                      <td>
                        <input className="eve-input" inputMode="decimal" value={editAmount} onChange={(event) => setEditAmount(event.target.value)} />
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
                      <td>{entry.description}</td>
                      <td className="eve-dim">{entry.client?.name ?? '—'}</td>
                      <td className="eve-dim">{entry.job?.title ?? '—'}</td>
                      <td className={entry.type === 'income' ? 'eve-financial__amount is-income' : 'eve-financial__amount is-expense'}>
                        {entry.type === 'income' ? '+' : '-'}
                        {formatCentsBRL(entry.amountCents)}
                      </td>
                      <td>
                        <button type="button" className="eve-btn eve-btn--icon" aria-label="Editar" onClick={() => startEdit(entry)}>
                          <Pencil size={14} aria-hidden="true" />
                        </button>
                        <button
                          type="button"
                          className="eve-btn eve-btn--icon"
                          aria-label="Apagar"
                          onClick={() => void deleteEntry(entry.id)}
                        >
                          <Trash2 size={14} aria-hidden="true" />
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
