'use client';

import { useState, type JSX } from 'react';
import { TYPE_NAME, type ColumnIssue, type ColumnType } from '../lib/table-import/analyze';
import type { ClientRef } from '../lib/table-import/clients';
import {
  acceptClientSuggestions,
  reanalyzeColumn,
  renameColumn,
  resetColumnType,
  setClientAction,
  summarizePlan,
  toggleColumn,
  type ImportPlan,
  type PlanColumn,
} from '../lib/table-import/plan';
import { TagPill } from './TagPill';
import { Check, ChevronDown, ChevronRight } from '@eve/ui';

const TYPE_ORDER: ColumnType[] = ['text', 'select', 'multiselect', 'client', 'date', 'number', 'boolean', 'url'];

const KIND_LABEL: Record<ColumnIssue['kind'], string> = {
  mismatch: 'Valores fora do tipo',
  ambiguous: 'Não deu para ter certeza',
  relation: 'Relação com Clientes',
};

function sampleValues(plan: ImportPlan, column: PlanColumn): string {
  const seen: string[] = [];
  for (const row of plan.rows) {
    const value = (row[column.index] ?? '').trim();
    if (value && !seen.includes(value)) seen.push(value.length > 40 ? `${value.slice(0, 40)}…` : value);
    if (seen.length >= 3) break;
  }
  return seen.join(' · ');
}

export interface ImportReviewProps {
  plan: ImportPlan;
  clients: ClientRef[];
  onPlanChange: (plan: ImportPlan) => void;
}

/**
 * The review of one file: what each column will become, and — only where
 * something is faulty, unclear or doesn't match — exactly which values and
 * what to do about them. Columns detection is sure about stay quiet, one
 * line each; nothing here blocks the import.
 */
export function ImportReview({ plan, clients, onPlanChange }: ImportReviewProps): JSX.Element {
  const summary = summarizePlan(plan);
  const visible = plan.columns.filter((column) => !column.empty);

  return (
    <div className="eve-import__review">
      <div className="eve-import__stats">
        <span>
          <strong>{summary.rowCount}</strong> linhas
        </span>
        <span>
          <strong>{summary.includedColumns}</strong> de {visible.length} colunas
        </span>
        {summary.flaggedColumns > 0 && (
          <span className="eve-import__flagcount">
            <strong>{summary.flaggedColumns}</strong> para revisar
          </span>
        )}
        {summary.newClients > 0 && (
          <span>
            <strong>{summary.newClients}</strong> cliente(s) novo(s)
          </span>
        )}
        {plan.skippedEmptyColumns > 0 && <span className="eve-dim">{plan.skippedEmptyColumns} coluna(s) vazia(s) ignorada(s)</span>}
      </div>

      {plan.warnings.map((warning) => (
        <div key={warning.message} className="eve-import__warning" role="alert">
          <p>{warning.message}</p>
          {warning.examples.length > 0 && (
            <ul>
              {warning.examples.map((example) => (
                <li key={example}>{example}</li>
              ))}
            </ul>
          )}
        </div>
      ))}

      <div className="eve-import__columns">
        {visible.map((column) => (
          <ColumnRow key={column.index} plan={plan} column={column} clients={clients} onPlanChange={onPlanChange} />
        ))}
      </div>
    </div>
  );
}

interface ColumnRowProps {
  plan: ImportPlan;
  column: PlanColumn;
  clients: ClientRef[];
  onPlanChange: (plan: ImportPlan) => void;
}

function ColumnRow({ plan, column, clients, onPlanChange }: ColumnRowProps): JSX.Element {
  const flagged = column.include && column.issues.length > 0;
  const [open, setOpen] = useState(false);
  const showDetails = flagged || open;

  return (
    <div className={['eve-import__col', flagged ? 'is-flagged' : '', column.include ? '' : 'is-off'].filter(Boolean).join(' ')}>
      <div className="eve-import__colhead">
        <input
          type="checkbox"
          className="eve-checkbox"
          aria-label={`Importar a coluna ${column.label}`}
          checked={column.include}
          onChange={(event) => onPlanChange(toggleColumn(plan, column.index, event.target.checked))}
        />
        <input
          className="eve-input eve-import__label"
          value={column.label}
          aria-label={`Nome da coluna ${column.header}`}
          onChange={(event) => onPlanChange(renameColumn(plan, column.index, event.target.value))}
        />
        <select
          className="eve-input eve-import__type"
          value={column.type}
          aria-label={`Tipo da coluna ${column.label}`}
          disabled={!column.include}
          onChange={(event) => onPlanChange(reanalyzeColumn(plan, column.index, clients, { type: event.target.value as ColumnType }))}
        >
          {TYPE_ORDER.map((type) => (
            <option key={type} value={type}>
              {TYPE_NAME[type]}
            </option>
          ))}
        </select>
        {flagged && (
          <span className="eve-import__badge" title="Tem algo que vale conferir">
            revisar
          </span>
        )}
        <button type="button" className="eve-btn eve-btn--icon" aria-label={open ? 'Recolher' : 'Ver detalhes'} onClick={() => setOpen((value) => !value)}>
          {showDetails ? <ChevronDown size={14} aria-hidden="true" /> : <ChevronRight size={14} aria-hidden="true" />}
        </button>
      </div>

      {column.include && (column.type === 'select' || column.type === 'multiselect') && column.options && (
        <div className="eve-import__tags">
          {column.options.slice(0, 10).map((option) => (
            <TagPill key={option} name={option} color={column.optionColors?.[option]} />
          ))}
          {column.options.length > 10 && <span className="eve-dim">+{column.options.length - 10}</span>}
        </div>
      )}

      {showDetails && (
        <div className="eve-import__details">
          <p className="eve-dim eve-import__note">
            {column.note}
            {column.type !== column.detectedType && (
              <>
                {' · '}
                <button type="button" className="eve-import__link" onClick={() => onPlanChange(resetColumnType(plan, column.index, clients))}>
                  voltar ao detectado ({TYPE_NAME[column.detectedType]})
                </button>
              </>
            )}
          </p>
          {sampleValues(plan, column) && <p className="eve-dim eve-import__sample">ex.: {sampleValues(plan, column)}</p>}

          {column.include &&
            column.issues.map((issue) => (
              <div key={`${issue.kind}-${issue.message}`} className={`eve-import__issue eve-import__issue--${issue.kind}`}>
                <p>
                  <strong>{KIND_LABEL[issue.kind]}:</strong> {issue.message}
                </p>
                {/* The per-name list below is this issue's detail; repeating the same names here just doubles the scroll. */}
                {issue.examples.length > 0 && issue.id !== 'unmatched-clients' && (
                  <ul>
                    {issue.examples.map((example) => (
                      <li key={`${example.row}-${example.value}`}>
                        linha {example.row}: “{example.value}”
                      </li>
                    ))}
                    {issue.count > issue.examples.length && <li className="eve-dim">…e mais {issue.count - issue.examples.length}</li>}
                  </ul>
                )}
              </div>
            ))}

          {column.include && column.type === 'number' && column.issues.some((issue) => issue.kind === 'ambiguous') && (
            <label className="eve-field">
              <span className="eve-field__label">Como ler “1.234”?</span>
              <select
                className="eve-input"
                value={column.numberLocale}
                onChange={(event) => onPlanChange(reanalyzeColumn(plan, column.index, clients, { numberLocale: event.target.value as 'pt' | 'en' }))}
              >
                <option value="pt">Ponto separa milhar (1.234 = 1234), vírgula é decimal</option>
                <option value="en">Ponto é decimal (1.234 = 1,234), vírgula separa milhar</option>
              </select>
            </label>
          )}

          {column.include && column.type === 'client' && <ClientNames plan={plan} column={column} clients={clients} onPlanChange={onPlanChange} />}
        </div>
      )}
    </div>
  );
}

function ClientNames({ plan, column, clients, onPlanChange }: ColumnRowProps): JSX.Element | null {
  const entries = column.clientNames ?? [];
  const matched = entries.filter((entry) => entry.action === 'match').length;
  const unresolved = entries.filter((entry) => entry.action !== 'match');
  const hasSuggestions = unresolved.some((entry) => entry.action === 'create' && entry.suggestion);

  if (entries.length === 0) return null;

  const encode = (entry: (typeof entries)[number]): string =>
    entry.action === 'use' && entry.clientId ? `use:${entry.clientId}` : entry.action === 'skip' ? 'skip' : 'create';

  return (
    <div className="eve-import__clients">
      <p className="eve-import__clientsummary">
        {matched > 0 && <span>
            <Check size={14} aria-hidden="true" /> {matched} já existe(m) em Clientes.{' '}
          </span>}
        {unresolved.length > 0 && <span>{unresolved.length} não bate(m) com nenhum cliente:</span>}
      </p>
      {hasSuggestions && (
        <button type="button" className="eve-btn" onClick={() => onPlanChange(acceptClientSuggestions(plan, column.index))}>
          Usar todas as sugestões parecidas
        </button>
      )}
      {unresolved.length > 0 && (
        <div className="eve-import__clientlist">
          {unresolved.map((entry) => (
            <div key={entry.key} className="eve-import__clientrow">
              <span className="eve-import__clientname">
                {entry.name} <span className="eve-dim">×{entry.count}</span>
              </span>
              <select
                className="eve-input"
                value={encode(entry)}
                aria-label={`O que fazer com ${entry.name}`}
                onChange={(event) => {
                  const value = event.target.value;
                  if (value === 'create') onPlanChange(setClientAction(plan, column.index, entry.key, 'create'));
                  else if (value === 'skip') onPlanChange(setClientAction(plan, column.index, entry.key, 'skip'));
                  else onPlanChange(setClientAction(plan, column.index, entry.key, 'use', value.slice(4)));
                }}
              >
                <option value="create">Criar cliente novo “{entry.name}”</option>
                {entry.suggestion && <option value={`use:${entry.suggestion.id}`}>Parecido: usar “{entry.suggestion.label}”</option>}
                {clients
                  .filter((client) => client.id !== entry.suggestion?.id)
                  .map((client) => (
                    <option key={client.id} value={`use:${client.id}`}>
                      Usar “{client.label}”
                    </option>
                  ))}
                <option value="skip">Deixar vazio</option>
              </select>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
