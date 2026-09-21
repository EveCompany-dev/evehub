'use client';

import { useCallback, useEffect, useRef, useState, type DragEvent, type JSX } from 'react';
import type { ClientRef } from '../lib/table-import/clients';
import { groupNotionCsvs, type CsvSource, type NotionDataset } from '../lib/table-import/notion';
import { buildImportPlan, summarizePlan, toImportPayload, type ImportPlan } from '../lib/table-import/plan';
import { extractCsvFiles, ZipError } from '../lib/table-import/zip';
import type { DataTableSummary } from './data-table-types';
import { ImportReview } from './ImportReview';
import { useEscapeToClose } from './useEscapeToClose';
import { CircleCheck, CircleX, X } from '@eve/ui';

export interface ImportWizardProps {
  onClose: () => void;
  /** Called once with every table that was created, so the workspace can list and select them. */
  onImported: (tables: DataTableSummary[]) => void;
}

type Variant = 'visible' | 'all';

interface WizardDataset {
  key: string;
  title: string;
  variant: Variant;
  include: boolean;
  tableName: string;
  plans: Partial<Record<Variant, ImportPlan>>;
}

interface ImportResult {
  title: string;
  ok: boolean;
  message: string;
  table?: DataTableSummary;
}

type Stage = 'pick' | 'choose' | 'review' | 'importing' | 'done';

const MAX_FILE_BYTES = 25 * 1024 * 1024;

function planFor(dataset: WizardDataset): ImportPlan | undefined {
  return dataset.plans[dataset.variant];
}

function describe(plan: ImportPlan | undefined): string {
  if (!plan) return '—';
  if (plan.unusable) return 'sem dados importáveis';
  const summary = summarizePlan(plan);
  return `${summary.includedColumns} colunas · ${summary.rowCount} linhas`;
}

async function readSources(files: File[]): Promise<{ sources: CsvSource[]; problems: string[] }> {
  const sources: CsvSource[] = [];
  const problems: string[] = [];

  for (const file of files) {
    const lower = file.name.toLowerCase();
    if (file.size > MAX_FILE_BYTES) {
      problems.push(`“${file.name}” tem mais de ${MAX_FILE_BYTES / 1024 / 1024} MB — é grande demais para importar de uma vez.`);
      continue;
    }
    try {
      if (lower.endsWith('.zip')) {
        const found = await extractCsvFiles(await file.arrayBuffer());
        if (found.length === 0) {
          problems.push(`Nenhum .csv dentro de “${file.name}”. No Notion, exporte como “Markdown & CSV”.`);
        }
        sources.push(...found.map((item) => ({ path: item.path, bytes: item.bytes })));
      } else if (lower.endsWith('.csv') || file.type === 'text/csv' || file.type === 'application/vnd.ms-excel') {
        sources.push({ path: file.name, bytes: new Uint8Array(await file.arrayBuffer()) });
      } else {
        problems.push(`“${file.name}” não é um arquivo .csv nem .zip.`);
      }
    } catch (cause) {
      problems.push(cause instanceof ZipError ? `“${file.name}”: ${cause.message}` : `Não consegui ler “${file.name}”: ${cause instanceof Error ? cause.message : String(cause)}`);
    }
  }
  return { sources, problems };
}

function toWizardDatasets(groups: NotionDataset[], clients: ClientRef[]): WizardDataset[] {
  return groups.map((group) => {
    const plans: Partial<Record<Variant, ImportPlan>> = {};
    if (group.visible) plans.visible = buildImportPlan({ fileName: group.visible.path, bytes: group.visible.bytes, clients, tableName: group.title });
    if (group.all) plans.all = buildImportPlan({ fileName: group.all.path, bytes: group.all.bytes, clients, tableName: group.title });
    // Only the full export exists -> that's the one; both -> the visible view is the default suggestion.
    const variant: Variant = plans.visible ? 'visible' : 'all';
    return { key: group.key, title: group.title, variant, include: true, tableName: group.title, plans };
  });
}

/**
 * CSV / Notion-export import. Always creates new tables (never merges into
 * an existing one). Accepts loose .csv files or the Notion export .zip;
 * when a database came out twice (visible view and "_all") it asks which to
 * use. Column types are guessed, and the review only draws attention to what
 * is faulty, unclear or doesn't match — see lib/table-import.
 */
export function ImportWizard({ onClose, onImported }: ImportWizardProps): JSX.Element {
  const [stage, setStage] = useState<Stage>('pick');
  const [datasets, setDatasets] = useState<WizardDataset[]>([]);
  const [clients, setClients] = useState<ClientRef[]>([]);
  const [clientsFailed, setClientsFailed] = useState(false);
  const [problems, setProblems] = useState<string[]>([]);
  const [reading, setReading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [results, setResults] = useState<ImportResult[]>([]);
  // Everything created so far, across retries — a second attempt at the failed ones must not re-import the good ones.
  const [created, setCreated] = useState<DataTableSummary[]>([]);
  const [progress, setProgress] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const close = () => (created.length > 0 ? onImported(created) : onClose());

  useEscapeToClose(() => {
    if (stage !== 'importing') close();
  });

  const loadClients = useCallback(async (): Promise<ClientRef[]> => {
    try {
      const response = await fetch('/api/scheduling/clients', { cache: 'no-store' });
      const body = (await response.json().catch(() => ({}))) as { clients?: { source: string; id: string; label: string }[] };
      if (!response.ok || !body.clients) {
        setClientsFailed(true);
        return [];
      }
      setClientsFailed(false);
      return body.clients.filter((client) => client.source === 'local').map((client) => ({ id: client.id, label: client.label }));
    } catch {
      setClientsFailed(true);
      return [];
    }
  }, []);

  useEffect(() => {
    // Mount fetch — the clients are what relation columns are matched against.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadClients().then(setClients);
  }, [loadClients]);

  const handleFiles = async (fileList: FileList | File[]) => {
    const files = Array.from(fileList);
    if (files.length === 0) return;
    setReading(true);
    setProblems([]);
    try {
      // Fresh list every time: a client added since the wizard opened should match.
      const currentClients = clients.length > 0 ? clients : await loadClients();
      if (currentClients !== clients) setClients(currentClients);

      const { sources, problems: found } = await readSources(files);
      setProblems(found);
      if (sources.length === 0) {
        if (found.length === 0) setProblems(['Nenhum arquivo .csv encontrado.']);
        return;
      }

      const next = toWizardDatasets(groupNotionCsvs(sources), currentClients);
      setDatasets(next);
      // Ask only when there is a real choice to make.
      const needsChoice = next.length > 1 || next.some((dataset) => dataset.plans.visible && dataset.plans.all);
      setStage(needsChoice ? 'choose' : 'review');
    } finally {
      setReading(false);
    }
  };

  const updateDataset = (key: string, change: (dataset: WizardDataset) => WizardDataset) =>
    setDatasets((current) => current.map((dataset) => (dataset.key === key ? change(dataset) : dataset)));

  const included = datasets.filter((dataset) => dataset.include && planFor(dataset) && !planFor(dataset)!.unusable);

  const runImport = async () => {
    setStage('importing');
    const out: ImportResult[] = [];
    for (const dataset of included) {
      const plan = planFor(dataset)!;
      setProgress(`Importando “${dataset.tableName}”…`);
      try {
        const payload = toImportPayload({ ...plan, tableName: dataset.tableName });
        const response = await fetch('/api/tables/import', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        const body = (await response.json().catch(() => ({}))) as {
          table?: DataTableSummary;
          rowCount?: number;
          createdClients?: number;
          error?: string;
        };
        if (!response.ok || !body.table) {
          out.push({ title: dataset.tableName, ok: false, message: body.error ?? `Falhou (HTTP ${response.status}).` });
        } else {
          const extra = body.createdClients ? ` · ${body.createdClients} cliente(s) novo(s)` : '';
          out.push({ title: dataset.tableName, ok: true, message: `${body.rowCount ?? 0} linhas${extra}`, table: body.table });
        }
      } catch (cause) {
        out.push({ title: dataset.tableName, ok: false, message: cause instanceof Error ? cause.message : String(cause) });
      }
    }
    setResults(out);
    const done = new Set(out.filter((result) => result.ok).map((result) => result.title));
    setCreated((current) => [...current, ...out.flatMap((result) => (result.table ? [result.table] : []))]);
    setDatasets((current) => current.map((dataset) => (done.has(dataset.tableName) ? { ...dataset, include: false } : dataset)));
    setProgress('');
    setStage('done');
  };

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragOver(false);
    void handleFiles(event.dataTransfer.files);
  };

  return (
    <div className="eve-modal-backdrop" onClick={stage === 'importing' ? undefined : close}>
      <div className="eve-modal eve-import" role="dialog" aria-label="Importar tabela" onClick={(event) => event.stopPropagation()}>
        <div className="eve-import__head">
          <h2 className="eve-card__title">Importar tabela</h2>
          <button type="button" className="eve-btn eve-btn--icon" aria-label="Fechar" disabled={stage === 'importing'} onClick={close}>
            <X size={14} aria-hidden="true" />
          </button>
        </div>

        {clientsFailed && (
          <p className="eve-alert eve-alert--error">
            Não consegui carregar a lista de Clientes, então colunas de cliente não serão ligadas aos existentes.{' '}
            <button type="button" className="eve-btn" onClick={() => void loadClients().then(setClients)}>
              Tentar de novo
            </button>
          </p>
        )}

        {problems.length > 0 && (
          <div className="eve-alert eve-alert--error" role="alert">
            {problems.map((problem) => (
              <p key={problem}>{problem}</p>
            ))}
          </div>
        )}

        {stage === 'pick' && (
          <div
            className={dragOver ? 'eve-import__drop is-over' : 'eve-import__drop'}
            onDragOver={(event) => {
              event.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={onDrop}
          >
            <p>
              <strong>Arraste aqui</strong> o .csv — ou o .zip inteiro do export do Notion.
            </p>
            <p className="eve-dim">
              Cada arquivo vira uma <strong>tabela nova</strong>. Tags, status, datas, links e clientes são reconhecidos sozinhos; só pergunto o que
              estiver duvidoso.
            </p>
            <button type="button" className="eve-btn eve-btn--primary" disabled={reading} onClick={() => inputRef.current?.click()}>
              {reading ? 'Lendo…' : 'Escolher arquivos'}
            </button>
            <input
              ref={inputRef}
              type="file"
              multiple
              accept=".csv,.zip,text/csv,application/zip"
              hidden
              onChange={(event) => {
                const files = event.target.files ? Array.from(event.target.files) : [];
                event.target.value = '';
                void handleFiles(files);
              }}
            />
          </div>
        )}

        {stage === 'choose' && (
          <>
            <p className="eve-dim">
              Escolha o que importar. Quando o Notion exportou um banco duas vezes, <strong>“visível”</strong> é o que a visualização salva mostrava e{' '}
              <strong>“completo” (_all)</strong> tem todas as colunas e linhas.
            </p>
            <div className="eve-import__datasets">
              {datasets.map((dataset) => (
                <div key={dataset.key} className={dataset.include ? 'eve-import__dataset' : 'eve-import__dataset is-off'}>
                  <label className="eve-import__datasethead">
                    <input
                      type="checkbox"
                      className="eve-checkbox"
                      checked={dataset.include}
                      onChange={(event) => updateDataset(dataset.key, (current) => ({ ...current, include: event.target.checked }))}
                    />
                    <input
                      className="eve-input"
                      value={dataset.tableName}
                      aria-label="Nome da tabela"
                      onChange={(event) => updateDataset(dataset.key, (current) => ({ ...current, tableName: event.target.value }))}
                    />
                  </label>
                  <div className="eve-import__variants">
                    {(['visible', 'all'] as const).map((variant) =>
                      dataset.plans[variant] ? (
                        <label key={variant} className="eve-import__variant">
                          <input
                            type="radio"
                            name={`variant-${dataset.key}`}
                            checked={dataset.variant === variant}
                            onChange={() => updateDataset(dataset.key, (current) => ({ ...current, variant }))}
                          />
                          <span>
                            {variant === 'visible' ? 'Visível (a visualização)' : 'Completo (_all)'} — <span className="eve-dim">{describe(dataset.plans[variant])}</span>
                          </span>
                        </label>
                      ) : null,
                    )}
                    {!(dataset.plans.visible && dataset.plans.all) && (
                      <span className="eve-dim">
                        {dataset.plans.all ? 'Só a versão completa (_all) foi enviada' : 'Uma versão'} — {describe(planFor(dataset))}
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
            <div className="eve-profile__actions">
              <button type="button" className="eve-btn eve-btn--primary" disabled={included.length === 0} onClick={() => setStage('review')}>
                Continuar
              </button>
              <button type="button" className="eve-btn" onClick={() => setStage('pick')}>
                Voltar
              </button>
            </div>
          </>
        )}

        {stage === 'review' && (
          <>
            {datasets
              .filter((dataset) => dataset.include)
              .map((dataset) => {
                const plan = planFor(dataset);
                return (
                  <section key={dataset.key} className="eve-import__section">
                    <div className="eve-import__sectionhead">
                      <input
                        className="eve-input eve-import__tablename"
                        value={dataset.tableName}
                        aria-label="Nome da tabela"
                        onChange={(event) => updateDataset(dataset.key, (current) => ({ ...current, tableName: event.target.value }))}
                      />
                      {dataset.plans.visible && dataset.plans.all && (
                        <select
                          className="eve-input"
                          value={dataset.variant}
                          aria-label="Versão do arquivo"
                          onChange={(event) => updateDataset(dataset.key, (current) => ({ ...current, variant: event.target.value as Variant }))}
                        >
                          <option value="visible">Visível — {describe(dataset.plans.visible)}</option>
                          <option value="all">Completo (_all) — {describe(dataset.plans.all)}</option>
                        </select>
                      )}
                    </div>
                    {!(dataset.plans.visible && dataset.plans.all) && plan && /[0-9a-f]{32}/i.test(plan.fileName) && (
                      <p className="eve-dim eve-import__variantnote">
                        {dataset.variant === 'all'
                          ? 'Versão completa (_all): todas as colunas e linhas do banco.'
                          : 'Versão visível (só o que a visualização mostrava). Envie também o arquivo _all para poder escolher a completa.'}
                      </p>
                    )}
                    {plan && !plan.unusable ? (
                      <ImportReview
                        plan={plan}
                        clients={clients}
                        onPlanChange={(next) =>
                          updateDataset(dataset.key, (current) => ({ ...current, plans: { ...current.plans, [current.variant]: next } }))
                        }
                      />
                    ) : (
                      <div className="eve-alert eve-alert--error" role="alert">
                        {(plan?.warnings ?? []).map((warning) => (
                          <p key={warning.message}>{warning.message}</p>
                        ))}
                        {!plan && <p>Arquivo não pôde ser lido.</p>}
                      </div>
                    )}
                  </section>
                );
              })}

            <div className="eve-profile__actions">
              <button type="button" className="eve-btn eve-btn--primary" disabled={included.length === 0} onClick={() => void runImport()}>
                Importar {included.length > 1 ? `${included.length} tabelas` : 'tabela'}
              </button>
              <button type="button" className="eve-btn" onClick={() => setStage(datasets.length > 1 || datasets.some((d) => d.plans.visible && d.plans.all) ? 'choose' : 'pick')}>
                Voltar
              </button>
            </div>
          </>
        )}

        {stage === 'importing' && <p className="eve-dim">{progress || 'Importando…'}</p>}

        {stage === 'done' && (
          <>
            <div className="eve-import__results">
              {results.map((result) => (
                <p key={result.title} className={result.ok ? 'eve-import__result' : 'eve-import__result is-error'} role={result.ok ? undefined : 'alert'}>
                  {result.ok ? <CircleCheck size={14} aria-hidden="true" /> : <CircleX size={14} aria-hidden="true" />} <strong>{result.title}</strong> — {result.message}
                </p>
              ))}
            </div>
            <div className="eve-profile__actions">
              <button type="button" className="eve-btn eve-btn--primary" onClick={close}>
                {created.length > 0 ? 'Abrir tabela' : 'Fechar'}
              </button>
              {results.some((result) => !result.ok) && (
                <button type="button" className="eve-btn" onClick={() => setStage('review')}>
                  Voltar e corrigir
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
