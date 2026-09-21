import { decodeCsvBytes, parseCsv, type CsvDelimiter } from './csv';
import { normalizeName, relationNames, type ClientRef } from './clients';
import {
  analyzeColumn,
  parseBoolean,
  splitTags,
  unmatchedClientsIssue,
  type ClientAction,
  type ClientNameEntry,
  type ColumnAnalysis,
  type ColumnType,
} from './analyze';
import { parseLooseNumber, type NumberLocale } from './numbers';

export type { ClientAction, ColumnType };

export interface FileWarning {
  message: string;
  /** Rows/values the warning is about, for the "see which" list. */
  examples: string[];
}

export interface PlanColumn extends ColumnAnalysis {
  /** Position of this column in the source file. */
  index: number;
  /** The header as written in the CSV. */
  header: string;
  /** The name the table column will get (deduplicated, never blank). */
  label: string;
  include: boolean;
}

export interface ImportPlan {
  fileName: string;
  tableName: string;
  delimiter: CsvDelimiter;
  encoding: 'utf-8' | 'windows-1252';
  /** Source rows, padded/cut to the header width. */
  rows: string[][];
  /** Spreadsheet row number of each entry in `rows` (the header is row 1). */
  rowNumbers: number[];
  columns: PlanColumn[];
  /** Whole-file problems: cut-off quotes, odd encoding, ragged rows, renamed headers. */
  warnings: FileWarning[];
  /** Blank columns that were dropped without asking — reported as a count, not a problem. */
  skippedEmptyColumns: number;
  /** True when nothing importable was found; `warnings` says why. */
  unusable: boolean;
}

export interface BuildPlanInput {
  fileName: string;
  bytes: Uint8Array;
  clients: ClientRef[];
  /** Defaults to the file name without its Notion id/_all suffix. */
  tableName?: string;
}

function cleanTableName(fileName: string): string {
  const base = fileName.split('/').pop() ?? fileName;
  return (
    base
      .replace(/\.csv$/i, '')
      .replace(/_all$/i, '')
      .replace(/\s+[0-9a-f]{32}$/i, '')
      .trim() || 'Tabela importada'
  );
}

function dedupeLabels(headers: string[]): { labels: string[]; warnings: FileWarning[] } {
  const warnings: FileWarning[] = [];
  const seen = new Map<string, number>();
  const blanks: string[] = [];
  const renamed: string[] = [];

  const labels = headers.map((raw, index) => {
    let label = raw.replace(/^﻿/, '').trim();
    if (!label) {
      label = `Coluna ${index + 1}`;
      blanks.push(label);
    }
    label = label.slice(0, 120);
    const key = normalizeName(label);
    const count = (seen.get(key) ?? 0) + 1;
    seen.set(key, count);
    if (count > 1) {
      const next = `${label} (${count})`;
      renamed.push(`${label} → ${next}`);
      return next;
    }
    return label;
  });

  if (blanks.length > 0) warnings.push({ message: `${blanks.length} coluna(s) sem título receberam um nome automático.`, examples: blanks });
  if (renamed.length > 0) warnings.push({ message: 'Títulos de coluna repetidos foram numerados.', examples: renamed });
  return { labels, warnings };
}

/** Reads a CSV file into an editable plan: what each column is, what to keep, and everything doubtful. */
export function buildImportPlan(input: BuildPlanInput): ImportPlan {
  const decoded = decodeCsvBytes(input.bytes);
  const parsed = parseCsv(decoded.text);
  const tableName = input.tableName ?? cleanTableName(input.fileName);

  const base: ImportPlan = {
    fileName: input.fileName,
    tableName,
    delimiter: parsed.delimiter,
    encoding: decoded.encoding,
    rows: [],
    rowNumbers: [],
    columns: [],
    warnings: [],
    skippedEmptyColumns: 0,
    unusable: false,
  };

  if (decoded.encoding === 'windows-1252') {
    base.warnings.push({ message: 'O arquivo não está em UTF-8; foi lido como Windows-1252 (Excel). Confira se os acentos estão certos.', examples: [] });
  } else if (decoded.suspicious) {
    base.warnings.push({
      message: 'Há caracteres estranhos no arquivo (acentos quebrados). Salve o CSV como UTF-8 e tente de novo se os textos ficarem errados.',
      examples: [],
    });
  }
  if (parsed.unterminatedQuote) {
    base.warnings.push({ message: 'Uma aspa ficou aberta no fim do arquivo — o final pode estar cortado ou o arquivo foi editado à mão.', examples: [] });
  }

  const [headerRow, ...dataRows] = parsed.rows;
  if (!headerRow || headerRow.length === 0) {
    return { ...base, unusable: true, warnings: [...base.warnings, { message: 'O arquivo está vazio.', examples: [] }] };
  }
  if (dataRows.length === 0) {
    return { ...base, unusable: true, warnings: [...base.warnings, { message: 'O arquivo só tem a linha de títulos — nenhuma linha de dados.', examples: [] }] };
  }

  const width = headerRow.length;
  const ragged: string[] = [];
  const rows: string[][] = [];
  const rowNumbers: number[] = [];
  dataRows.forEach((cells, index) => {
    // Row numbers count the header as row 1, like the spreadsheet the CSV came from.
    const rowNumber = index + 2;
    if (cells.length !== width) ragged.push(`linha ${rowNumber}: ${cells.length} colunas (esperado ${width})`);
    rows.push(Array.from({ length: width }, (_, column) => cells[column] ?? ''));
    rowNumbers.push(rowNumber);
  });
  if (ragged.length > 0) {
    base.warnings.push({
      message: `${ragged.length} linha(s) têm um número de colunas diferente do título. Colunas a mais foram ignoradas e as que faltam ficaram vazias.`,
      examples: ragged.slice(0, 5),
    });
  }

  const { labels, warnings: labelWarnings } = dedupeLabels(headerRow);
  base.warnings.push(...labelWarnings);

  const columns: PlanColumn[] = headerRow.map((header, index) => {
    const analysis = analyzeColumn({
      header,
      values: rows.map((row) => row[index] ?? ''),
      rowNumbers,
      isFirstColumn: index === 0,
      clients: input.clients,
    });
    return { ...analysis, index, header, label: labels[index]!, include: !analysis.empty };
  });

  const skipped = columns.filter((column) => column.empty).length;
  const usable = columns.some((column) => column.include);

  return {
    ...base,
    rows,
    rowNumbers,
    columns,
    skippedEmptyColumns: skipped,
    unusable: !usable,
    warnings: usable ? base.warnings : [...base.warnings, { message: 'Todas as colunas estão vazias.', examples: [] }],
  };
}

function replaceColumn(plan: ImportPlan, index: number, change: (column: PlanColumn) => PlanColumn): ImportPlan {
  return { ...plan, columns: plan.columns.map((column) => (column.index === index ? change(column) : column)) };
}

/** Re-runs one column's analysis with a type (and number format) the user picked, keeping their per-client choices. */
export function reanalyzeColumn(
  plan: ImportPlan,
  index: number,
  clients: ClientRef[],
  override: { type?: ColumnType; numberLocale?: NumberLocale },
): ImportPlan {
  return replaceColumn(plan, index, (column) => {
    const analysis = analyzeColumn({
      header: column.header,
      values: plan.rows.map((row) => row[index] ?? ''),
      rowNumbers: plan.rowNumbers,
      isFirstColumn: index === 0,
      clients,
      ...(override.type ? { forceType: override.type } : { forceType: column.type }),
      numberLocale: override.numberLocale ?? column.numberLocale,
      ...(column.clientNames ? { previousClientNames: column.clientNames } : {}),
    });
    return { ...column, ...analysis, clientNames: analysis.clientNames, include: column.include };
  });
}

/** Back to whatever detection originally picked for this column. */
export function resetColumnType(plan: ImportPlan, index: number, clients: ClientRef[]): ImportPlan {
  return replaceColumn(plan, index, (column) => {
    const analysis = analyzeColumn({
      header: column.header,
      values: plan.rows.map((row) => row[index] ?? ''),
      rowNumbers: plan.rowNumbers,
      isFirstColumn: index === 0,
      clients,
    });
    return { ...column, ...analysis, clientNames: analysis.clientNames, include: column.include };
  });
}

export function toggleColumn(plan: ImportPlan, index: number, include: boolean): ImportPlan {
  return replaceColumn(plan, index, (column) => ({ ...column, include }));
}

export function renameColumn(plan: ImportPlan, index: number, label: string): ImportPlan {
  return replaceColumn(plan, index, (column) => ({ ...column, label }));
}

export function setClientAction(plan: ImportPlan, index: number, key: string, action: ClientAction, clientId: string | null = null): ImportPlan {
  return replaceColumn(plan, index, (column) => {
    const clientNames = (column.clientNames ?? []).map((entry) => (entry.key === key ? { ...entry, action, clientId } : entry));
    return { ...column, clientNames, issues: refreshClientIssues(column, clientNames) };
  });
}

/** Uses the suggested existing client for every name that has one and wasn't matched exactly. */
export function acceptClientSuggestions(plan: ImportPlan, index: number): ImportPlan {
  return replaceColumn(plan, index, (column) => {
    const clientNames = (column.clientNames ?? []).map((entry) =>
      entry.action === 'create' && entry.suggestion ? { ...entry, action: 'use' as const, clientId: entry.suggestion.id } : entry,
    );
    return { ...column, clientNames, issues: refreshClientIssues(column, clientNames) };
  });
}

function refreshClientIssues(column: PlanColumn, clientNames: ClientNameEntry[]): PlanColumn['issues'] {
  const others = column.issues.filter((item) => item.id !== 'unmatched-clients');
  const unmatched = unmatchedClientsIssue(clientNames);
  return unmatched ? [unmatched, ...others] : others;
}

export interface PlanSummary {
  includedColumns: number;
  rowCount: number;
  flaggedColumns: number;
  newClients: number;
}

export function summarizePlan(plan: ImportPlan): PlanSummary {
  const included = plan.columns.filter((column) => column.include);
  const newNames = new Set<string>();
  for (const column of included) {
    if (column.type !== 'client') continue;
    for (const entry of column.clientNames ?? []) if (entry.action === 'create') newNames.add(entry.key);
  }
  return {
    includedColumns: included.length,
    rowCount: plan.rows.length,
    flaggedColumns: included.filter((column) => column.issues.length > 0).length,
    newClients: newNames.size,
  };
}

// --- payload sent to POST /api/tables/import -----------------------------------

export interface ImportColumnPayload {
  label: string;
  type: ColumnType;
  options?: string[];
  optionColors?: Record<string, string>;
}

export interface ImportPayload {
  name: string;
  columns: ImportColumnPayload[];
  /** One entry per row, aligned with `columns`. Client cells hold a client id or "new:<name>". */
  rows: unknown[][];
  /** Display names of clients the server must create (each referenced as "new:<name>" in rows). */
  newClients: string[];
}

function cellValue(column: PlanColumn, raw: string): unknown {
  const text = raw.trim();
  if (text === '') return null;
  switch (column.type) {
    case 'number': {
      const parsed = parseLooseNumber(text, column.numberLocale);
      return parsed ? parsed.value : null;
    }
    case 'boolean':
      return parseBoolean(text);
    case 'multiselect': {
      const tags = splitTags(text);
      return tags.length > 0 ? tags : null;
    }
    case 'client': {
      const name = relationNames(text)[0];
      if (!name) return null;
      const entry = column.clientNames?.find((item) => item.key === normalizeName(name));
      if (!entry || entry.action === 'skip') return null;
      if (entry.action === 'create') return `new:${entry.name}`;
      return entry.clientId;
    }
    default:
      return text;
  }
}

/** The rows and columns the plan resolves to. Blank rows (nothing left after exclusions/casts) are dropped. */
export function toImportPayload(plan: ImportPlan): ImportPayload {
  const columns = plan.columns.filter((column) => column.include);
  const newClients = new Map<string, string>();
  for (const column of columns) {
    if (column.type !== 'client') continue;
    for (const entry of column.clientNames ?? []) if (entry.action === 'create') newClients.set(entry.key, entry.name);
  }

  const rows = plan.rows
    .map((row) => columns.map((column) => cellValue(column, row[column.index] ?? '')))
    .filter((cells) => cells.some((cell) => cell !== null && !(Array.isArray(cell) && cell.length === 0)));

  return {
    name: plan.tableName.trim() || 'Tabela importada',
    columns: columns.map((column) => ({
      label: column.label.trim() || column.header || 'Coluna',
      type: column.type,
      ...(column.options && (column.type === 'select' || column.type === 'multiselect')
        ? { options: column.options, optionColors: column.optionColors }
        : {}),
    })),
    rows,
    newClients: [...newClients.values()],
  };
}
