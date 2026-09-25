'use client';

import { strings, X } from '@eve/ui';
import { useEffect, useState, type JSX } from 'react';
import { memberInitials, memberLabel, type JobColumnSummary, type JobMember, type JobSummary } from './job-types';
import { LocalizedDateInput } from './LocalizedDateInput';
import { MemberSelect } from './MemberSelect';
import { useEscapeToClose } from './useEscapeToClose';
import { useFormattingToolbar } from './useFormattingToolbar';

export interface JobCreateModalProps {
  columns: JobColumnSummary[];
  members: JobMember[];
  /** Pre-selected column (the "+" on a column header); the first column otherwise. */
  initialColumnId?: string;
  initialTitle?: string;
  onClose: () => void;
  onCreated: (jobs: JobSummary[]) => void;
}

interface ClientOption {
  id: string;
  name: string;
}

/**
 * "Adicionar job": everything a job starts with in one place — título,
 * cliente, prazo, responsável, envolvidos and the full briefing — plus
 * "duplicar para outros clientes", which creates one identical job per extra
 * client in the same request.
 */
export function JobCreateModal({ columns, members, initialColumnId, initialTitle = '', onClose, onCreated }: JobCreateModalProps): JSX.Element {
  useEscapeToClose(onClose);
  const [title, setTitle] = useState(initialTitle);
  const [columnId, setColumnId] = useState(initialColumnId ?? columns[0]?.id ?? '');
  const [clientId, setClientId] = useState('');
  const [dueDate, setDueDate] = useState<string | null>(null);
  const [responsibleId, setResponsibleId] = useState<string | null>(null);
  const [involvedIds, setInvolvedIds] = useState<string[]>([]);
  const [briefing, setBriefing] = useState('');
  const [duplicateIds, setDuplicateIds] = useState<string[]>([]);
  const [clients, setClients] = useState<ClientOption[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { textareaRef, toolbar } = useFormattingToolbar(briefing, setBriefing);

  useEffect(() => {
    // Mount fetch — same legitimate case as useWidgetData.ts's initial fetch.
    void (async () => {
      try {
        const response = await fetch('/api/scheduling/clients', { cache: 'no-store' });
        const body = (await response.json().catch(() => ({}))) as { clients?: { source: string; id: string; label: string }[] };
        if (response.ok && body.clients) {
          setClients(
            body.clients
              .filter((client) => client.source === 'local')
              .map((client) => ({ id: client.id, name: client.label }))
              .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR')),
          );
        }
      } catch {
        // The client picker just stays empty; the job can still be created without one.
      }
    })();
  }, []);

  const involved = involvedIds.map((id) => members.find((member) => member.id === id)).filter((member): member is JobMember => !!member);
  const availableInvolved = members.filter((member) => !involvedIds.includes(member.id));
  const duplicateOptions = clients.filter((client) => client.id !== clientId);

  const submit = async () => {
    if (!title.trim()) {
      setError('Dê um título ao job.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const response = await fetch('/api/jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: title.trim(),
          columnId: columnId || undefined,
          clientId: clientId || null,
          dueDate,
          responsibleId,
          collaboratorUserIds: involvedIds,
          description: briefing.trim() || undefined,
          duplicateClientIds: duplicateIds.filter((id) => id !== clientId),
        }),
      });
      const body = (await response.json().catch(() => ({}))) as { jobs?: JobSummary[]; error?: string };
      if (!response.ok || !body.jobs) {
        setError(body.error ?? `HTTP ${response.status}`);
        return;
      }
      onCreated(body.jobs);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="eve-modal-backdrop" onClick={onClose}>
      <div className="eve-modal eve-modal--wide eve-job-create" role="dialog" aria-label={strings.jobs.addJob} onClick={(event) => event.stopPropagation()}>
        <h2 className="eve-card__title">{strings.jobs.addJob}</h2>
        {error && <p className="eve-alert eve-alert--error">{error}</p>}

        <label className="eve-field">
          <span className="eve-field__label">Título</span>
          <input
            className="eve-input"
            autoFocus
            placeholder={strings.jobs.jobTitlePlaceholder}
            value={title}
            onChange={(event) => setTitle(event.target.value)}
          />
        </label>

        <div className="eve-job-create__grid">
          <label className="eve-field">
            <span className="eve-field__label">{strings.jobs.client}</span>
            <select
              className="eve-input"
              value={clientId}
              onChange={(event) => {
                setClientId(event.target.value);
                setDuplicateIds((current) => current.filter((id) => id !== event.target.value));
              }}
            >
              <option value="">{strings.jobs.noClient}</option>
              {clients.map((client) => (
                <option key={client.id} value={client.id}>
                  {client.name}
                </option>
              ))}
            </select>
          </label>

          <label className="eve-field">
            <span className="eve-field__label">{strings.jobs.dueDate}</span>
            <LocalizedDateInput value={dueDate} onChange={setDueDate} />
          </label>

          <div className="eve-field">
            <span className="eve-field__label">{strings.jobs.responsible}</span>
            <MemberSelect
              members={members}
              value={responsibleId}
              placeholder={strings.jobs.noResponsible}
              noneLabel={strings.jobs.noResponsible}
              onChange={setResponsibleId}
            />
          </div>

          {columns.length > 1 && (
            <label className="eve-field">
              <span className="eve-field__label">{strings.jobs.column}</span>
              <select className="eve-input" value={columnId} onChange={(event) => setColumnId(event.target.value)}>
                {columns.map((column) => (
                  <option key={column.id} value={column.id}>
                    {column.name}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>

        <div className="eve-field">
          <span className="eve-field__label">{strings.jobs.collaborators}</span>
          {involved.length > 0 && (
            <ul className="eve-jobs__collaborator-list">
              {involved.map((member) => (
                <li key={member.id} className="eve-jobs__collaborator">
                  <span className="eve-avatar eve-avatar--fallback" style={{ width: 24, height: 24, fontSize: 10 }}>
                    {memberInitials(member)}
                  </span>
                  <span>{memberLabel(member)}</span>
                  <button
                    type="button"
                    className="eve-btn eve-btn--icon"
                    title={strings.jobs.removeCollaborator}
                    aria-label={`${strings.jobs.removeCollaborator} ${memberLabel(member)}`}
                    onClick={() => setInvolvedIds((current) => current.filter((id) => id !== member.id))}
                  >
                    <X size={14} aria-hidden="true" />
                  </button>
                </li>
              ))}
            </ul>
          )}
          {availableInvolved.length > 0 && (
            <MemberSelect
              members={availableInvolved}
              value={null}
              placeholder={strings.jobs.pickMember}
              onChange={(id) => id && setInvolvedIds((current) => [...current, id])}
            />
          )}
        </div>

        <label className="eve-field">
          <span className="eve-field__label">{strings.jobs.description}</span>
          <textarea
            ref={textareaRef}
            className="eve-input"
            rows={6}
            placeholder={strings.jobs.descriptionPlaceholder}
            value={briefing}
            onChange={(event) => setBriefing(event.target.value)}
          />
          {toolbar}
        </label>

        {duplicateOptions.length > 0 && (
          <fieldset className="eve-field eve-job-create__duplicate">
            <legend className="eve-field__label">{strings.jobs.duplicateForClients}</legend>
            <p className="eve-dim">{strings.jobs.duplicateHint}</p>
            <div className="eve-job-create__clients">
              {duplicateOptions.map((client) => (
                <label key={client.id} className="eve-job-create__client">
                  <input
                    type="checkbox"
                    checked={duplicateIds.includes(client.id)}
                    onChange={(event) =>
                      setDuplicateIds((current) => (event.target.checked ? [...current, client.id] : current.filter((id) => id !== client.id)))
                    }
                  />
                  {client.name}
                </label>
              ))}
            </div>
          </fieldset>
        )}

        <div className="eve-profile__actions">
          <button type="button" className="eve-btn eve-btn--primary" disabled={busy} onClick={() => void submit()}>
            {busy ? strings.jobs.creatingJob : duplicateIds.length > 0 ? `${strings.jobs.createJob} (${duplicateIds.length + 1})` : strings.jobs.createJob}
          </button>
          <button type="button" className="eve-btn" onClick={onClose}>
            {strings.edit.cancel}
          </button>
        </div>
      </div>
    </div>
  );
}
