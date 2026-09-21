import { isDateShaped, looksLikeDate } from '../table-dates';
import { guessTagColor, hashTagColor } from '../table-tags';
import { hasNotionLink, matchClient, normalizeName, relationNames, type ClientRef } from './clients';
import { parseLooseNumber, type NumberLocale } from './numbers';

export type ColumnType = 'text' | 'number' | 'boolean' | 'date' | 'select' | 'multiselect' | 'url' | 'client';

export type IssueKind = 'mismatch' | 'ambiguous' | 'relation';

export interface CellExample {
  /** Spreadsheet row number (the header is row 1). */
  row: number;
  value: string;
}

/** Something in a column the user should look at — never a hard stop, always with the affected values. */
export interface ColumnIssue {
  /** Set on issues that are recomputed as the user answers them (see unmatchedClientsIssue). */
  id?: 'unmatched-clients';
  kind: IssueKind;
  message: string;
  count: number;
  examples: CellExample[];
}

export type ClientAction = 'match' | 'create' | 'use' | 'skip';

export interface ClientNameEntry {
  /** normalizeName(name) — the identity used to resolve every cell with this name. */
  key: string;
  name: string;
  count: number;
  rows: number[];
  action: ClientAction;
  /** The client this name resolves to for 'match' (exact) and 'use' (chosen). */
  clientId: string | null;
  suggestion: ClientRef | null;
}

export interface ColumnAnalysis {
  empty: boolean;
  type: ColumnType;
  /** What detection picked, so the UI can offer "back to detected" after a manual override. */
  detectedType: ColumnType;
  /** Why this type — shown next to the column so the guess is never a black box. */
  note: string;
  options?: string[];
  optionColors?: Record<string, string>;
  numberLocale: NumberLocale;
  clientNames?: ClientNameEntry[];
  issues: ColumnIssue[];
}

export interface AnalyzeInput {
  header: string;
  /** Raw cell text for every data row, blanks included (index = data row). */
  values: string[];
  /** Spreadsheet row number of each data row, for messages. */
  rowNumbers: number[];
  isFirstColumn: boolean;
  clients: ClientRef[];
  forceType?: ColumnType;
  numberLocale?: NumberLocale;
  /** Keep the user's per-name decisions when a column is re-analyzed (e.g. after switching the number locale). */
  previousClientNames?: ClientNameEntry[];
}

const MAX_EXAMPLES = 5;

const BOOLEAN_TRUE = new Set(['yes', 'true', 'sim', 'checked', 'x', '✓', '✔', 'verdadeiro']);
const BOOLEAN_FALSE = new Set(['no', 'false', 'nao', 'não', 'unchecked', 'falso']);

export function parseBoolean(value: string): boolean | null {
  const key = value.trim().toLowerCase();
  if (BOOLEAN_TRUE.has(key)) return true;
  if (BOOLEAN_FALSE.has(key) || BOOLEAN_FALSE.has(normalizeName(key))) return false;
  return null;
}

const URL_PATTERN = /^(https?:\/\/|www\.)\S+$/i;

export function isUrl(value: string): boolean {
  return URL_PATTERN.test(value.trim());
}

type HeaderHint = 'client' | 'tags' | 'status' | null;

function headerHint(header: string): HeaderHint {
  const key = normalizeName(header);
  if (/^(clientes?|marcas?|client|customers?)\b/.test(key)) return 'client';
  if (/\b(tags?|etiquetas?|categorias?|labels?|marcadores?)\b/.test(key)) return 'tags';
  if (/\b(status|situacao|estado|etapa|fase|prioridade|tipo|formato|canal|funil|objetivo|responsavel)\b/.test(key)) return 'status';
  return null;
}

/** Splits a tag cell ("Reels, Feed") into its distinct, trimmed values. */
export function splitTags(cell: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of cell.split(',')) {
    const tag = part.trim();
    if (!tag || seen.has(tag)) continue;
    seen.add(tag);
    out.push(tag);
  }
  return out;
}

function colorsFor(options: string[]): Record<string, string> {
  return Object.fromEntries(options.map((option) => [option, guessTagColor(option) ?? hashTagColor(option)]));
}

interface Cell {
  row: number;
  text: string;
}

function issue(kind: IssueKind, message: string, cells: Cell[]): ColumnIssue {
  return {
    kind,
    message,
    count: cells.length,
    examples: cells.slice(0, MAX_EXAMPLES).map((cell) => ({ row: cell.row, value: cell.text })),
  };
}

function distinctInOrder(values: string[]): string[] {
  return [...new Set(values)];
}

const EMPTY_ANALYSIS: Omit<ColumnAnalysis, 'type' | 'detectedType' | 'note'> = { empty: true, numberLocale: 'pt', issues: [] };

function detectNumberLocale(nonEmpty: string[]): { locale: NumberLocale; conflict: boolean } {
  let pt = false;
  let en = false;
  for (const raw of nonEmpty) {
    const text = raw.replace(/^(R\$|US\$|\$|€|£)\s*/i, '').trim();
    const hasDot = text.includes('.');
    const hasComma = text.includes(',');
    if (hasDot && hasComma) {
      if (text.lastIndexOf(',') > text.lastIndexOf('.')) pt = true;
      else en = true;
    } else if (hasComma && /,(\d{1,2}|\d{4,})$/.test(text)) {
      pt = true;
    } else if (hasDot && /\.(\d{1,2}|\d{4,})$/.test(text)) {
      en = true;
    }
  }
  if (pt && en) return { locale: 'pt', conflict: true };
  return { locale: en ? 'en' : 'pt', conflict: false };
}

/**
 * Looks at one column's raw cells and decides what it is, and what about it
 * is doubtful. Detection is deliberately conservative — a doubtful column
 * falls back to a type that loses nothing (text, or date/select which keep
 * the original words) and says so in `issues`, rather than dropping data.
 */
export function analyzeColumn(input: AnalyzeInput): ColumnAnalysis {
  const { header, values, rowNumbers } = input;
  const cells: Cell[] = values.map((value, index) => ({ row: rowNumbers[index] ?? index + 2, text: value.trim() }));
  const filled = cells.filter((cell) => cell.text !== '');

  if (filled.length === 0) {
    return { ...EMPTY_ANALYSIS, type: input.forceType ?? 'text', detectedType: 'text', note: 'Coluna vazia' };
  }

  const hint = headerHint(header);
  const detected = detect(input, filled, hint);
  const type = input.forceType ?? detected.type;

  const built = build(type, input, filled);
  const note = input.forceType && input.forceType !== detected.type ? `Tipo escolhido por você (detectado: ${TYPE_NAME[detected.type]})` : detected.note;

  return {
    empty: false,
    type,
    detectedType: detected.type,
    note,
    numberLocale: built.numberLocale ?? input.numberLocale ?? 'pt',
    ...(built.options ? { options: built.options, optionColors: colorsFor(built.options) } : {}),
    ...(built.clientNames ? { clientNames: built.clientNames } : {}),
    issues: [...detected.issues, ...built.issues],
  };
}

export const TYPE_NAME: Record<ColumnType, string> = {
  text: 'Texto',
  number: 'Número',
  boolean: 'Sim/Não',
  date: 'Data',
  select: 'Seleção',
  multiselect: 'Tags',
  url: 'Link',
  client: 'Cliente',
};

interface Detection {
  type: ColumnType;
  note: string;
  /** Doubts about the *choice* of type itself (as opposed to bad values inside it, which build() reports). */
  issues: ColumnIssue[];
}

function detect(input: AnalyzeInput, filled: Cell[], hint: HeaderHint): Detection {
  const { clients, isFirstColumn } = input;
  const texts = filled.map((cell) => cell.text);
  const relaxed = hint === 'tags' || hint === 'status';

  // --- client relation --------------------------------------------------------
  const names = filled.flatMap((cell) => relationNames(cell.text));
  const distinctNames = distinctInOrder(names);
  const matchedNames = distinctNames.filter((name) => matchClient(name, clients).exact).length;
  const looksRelational = filled.some((cell) => hasNotionLink(cell.text));
  if (hint === 'client' || looksRelational || (clients.length > 0 && distinctNames.length > 0 && matchedNames / distinctNames.length >= 0.6)) {
    return {
      type: 'client',
      note: hint === 'client' ? 'Detectado pelo nome da coluna: relação com Clientes' : 'Detectado: nomes que batem com Clientes',
      issues: [],
    };
  }

  // --- boolean -----------------------------------------------------------------
  if (texts.every((text) => parseBoolean(text) !== null)) {
    return { type: 'boolean', note: 'Detectado: Sim/Não', issues: [] };
  }

  // --- link --------------------------------------------------------------------
  if (texts.every(isUrl)) return { type: 'url', note: 'Detectado: links', issues: [] };

  // --- number ------------------------------------------------------------------
  if (texts.every((text) => parseLooseNumber(text) !== null)) {
    return { type: 'number', note: 'Detectado: números', issues: [] };
  }

  // --- date --------------------------------------------------------------------
  const dateCount = texts.filter((text) => looksLikeDate(text) || isDateShaped(text)).length;
  if (dateCount === texts.length || (dateCount >= 2 && dateCount / texts.length >= 0.7)) {
    return { type: 'date', note: 'Detectado: datas', issues: [] };
  }

  // --- select / multiselect ----------------------------------------------------
  if (!isFirstColumn || relaxed) {
    const distinct = distinctInOrder(texts);
    const maxDistinct = relaxed ? 60 : 30;
    const maxLength = relaxed ? 60 : 40;
    const minRepeat = relaxed ? 1 : 1.5;

    const tokenLists = texts.map(splitTags);
    const multiCells = tokenLists.filter((tokens) => tokens.length > 1);
    const allTokens = tokenLists.flat();
    const distinctTokens = distinctInOrder(allTokens);
    const tokenOk =
      distinctTokens.length > 0 &&
      distinctTokens.length <= maxDistinct &&
      allTokens.length / distinctTokens.length >= minRepeat &&
      distinctTokens.every((token) => token.length <= maxLength);

    if (tokenOk && (multiCells.length > 0 || hint === 'tags')) {
      const doubts: ColumnIssue[] = [];
      if (hint !== 'tags' && multiCells.length / texts.length < 0.25) {
        doubts.push(
          issue(
            'ambiguous',
            `Só ${multiCells.length} de ${texts.length} células têm mais de um valor separado por vírgula. Confirme se são tags ou texto corrido.`,
            filled.filter((cell) => splitTags(cell.text).length > 1),
          ),
        );
      }
      return { type: 'multiselect', note: 'Detectado: tags (vários valores por célula)', issues: doubts };
    }

    const selectOk =
      distinct.length <= maxDistinct && texts.length / distinct.length >= minRepeat && distinct.every((value) => value.length <= maxLength);
    if (selectOk) return { type: 'select', note: 'Detectado: poucas opções que se repetem (tags/status)', issues: [] };
  }

  return { type: 'text', note: 'Texto livre', issues: [] };
}

interface Built {
  options?: string[];
  numberLocale?: NumberLocale;
  clientNames?: ClientNameEntry[];
  issues: ColumnIssue[];
}

function build(type: ColumnType, input: AnalyzeInput, filled: Cell[]): Built {
  switch (type) {
    case 'number': {
      const { locale: evidence, conflict } = detectNumberLocale(filled.map((cell) => cell.text));
      const locale = input.numberLocale ?? evidence;
      const issues: ColumnIssue[] = [];
      const bad = filled.filter((cell) => parseLooseNumber(cell.text, locale) === null);
      if (bad.length > 0) issues.push(issue('mismatch', `${bad.length} valor(es) não são número e ficarão vazios.`, bad));
      const ambiguous = filled.filter((cell) => parseLooseNumber(cell.text, locale)?.ambiguous);
      if (ambiguous.length > 0 && !input.numberLocale && evidence === 'pt' && !conflict && !hasLocaleEvidence(filled)) {
        issues.push(
          issue('ambiguous', 'Não dá para saber se o ponto/vírgula é milhar ou decimal (ex.: 1.234 = 1234 ou 1,234?). Escolha abaixo.', ambiguous),
        );
      }
      if (conflict) issues.push(issue('ambiguous', 'Formatos numéricos misturados (1.234,5 e 1,234.5).', filled.slice(0, MAX_EXAMPLES)));
      return { numberLocale: locale, issues };
    }

    case 'boolean': {
      const bad = filled.filter((cell) => parseBoolean(cell.text) === null);
      return { issues: bad.length ? [issue('mismatch', `${bad.length} valor(es) não são Sim/Não e ficarão vazios.`, bad)] : [] };
    }

    case 'url': {
      const bad = filled.filter((cell) => !isUrl(cell.text));
      return { issues: bad.length ? [issue('mismatch', `${bad.length} valor(es) não parecem um link (serão mantidos como texto do link).`, bad)] : [] };
    }

    case 'date': {
      const bad = filled.filter((cell) => !looksLikeDate(cell.text));
      // Dates are stored as written, so nothing is lost — but a calendar can't place these.
      const usStyle = bad.filter((cell) => isDateShaped(cell.text)).length;
      const hint = usStyle > 0 ? ` ${usStyle} parece(m) estar em mês/dia/ano.` : '';
      return {
        issues: bad.length
          ? [issue('mismatch', `${bad.length} valor(es) não são uma data reconhecível (lemos dia/mês/ano).${hint} Ficam como estão, mas não aparecem no calendário.`, bad)]
          : [],
      };
    }

    case 'select': {
      const options = distinctInOrder(filled.map((cell) => cell.text));
      const issues: ColumnIssue[] = [];
      if (options.length > 60) {
        issues.push(issue('ambiguous', `${options.length} opções diferentes — talvez isto seja texto livre, não uma seleção.`, filled));
      }
      return { options, issues };
    }

    case 'multiselect': {
      const options = distinctInOrder(filled.flatMap((cell) => splitTags(cell.text)));
      const issues: ColumnIssue[] = [];
      if (options.length > 60) {
        issues.push(issue('ambiguous', `${options.length} tags diferentes — talvez isto seja texto livre, não tags.`, filled));
      }
      return { options, issues };
    }

    case 'client':
      return buildClientNames(input, filled);

    default:
      return { issues: [] };
  }
}

function hasLocaleEvidence(filled: Cell[]): boolean {
  return filled.some((cell) => {
    const text = cell.text;
    return (text.includes('.') && text.includes(',')) || /[.,]\d{1,2}$/.test(text) || /[.,]\d{4,}$/.test(text);
  });
}

/** The 'these names aren't in Clientes yet' notice — recomputed whenever the user changes a name's action. */
export function unmatchedClientsIssue(clientNames: ClientNameEntry[]): ColumnIssue | null {
  const pending = clientNames.filter((entry) => entry.action === 'create');
  if (pending.length === 0) return null;
  const withSuggestion = pending.filter((entry) => entry.suggestion).length;
  const message =
    withSuggestion > 0
      ? `${pending.length} nome(s) não existem em Clientes (${withSuggestion} com sugestão parecida). Confirme abaixo se cria cliente novo ou usa o existente.`
      : `${pending.length} nome(s) não existem em Clientes. Serão criados como clientes novos, a menos que você mude abaixo.`;
  return {
    id: 'unmatched-clients',
    kind: 'relation',
    message,
    count: pending.length,
    examples: pending.slice(0, MAX_EXAMPLES).map((entry) => ({ row: entry.rows[0]!, value: entry.name })),
  };
}

function buildClientNames(input: AnalyzeInput, filled: Cell[]): Built {
  const { clients, previousClientNames } = input;
  const byKey = new Map<string, ClientNameEntry>();
  const multiCells: Cell[] = [];

  for (const cell of filled) {
    const names = relationNames(cell.text);
    if (names.length > 1) multiCells.push(cell);
    // A cell can only hold one client; the first name wins (the issue below says so).
    const name = names[0];
    if (!name) continue;
    const key = normalizeName(name);
    const entry = byKey.get(key);
    if (entry) {
      entry.count += 1;
      entry.rows.push(cell.row);
      continue;
    }
    const { exact, suggestion } = matchClient(name, clients);
    const previous = previousClientNames?.find((item) => item.key === key);
    byKey.set(key, {
      key,
      name,
      count: 1,
      rows: [cell.row],
      action: previous?.action ?? (exact ? 'match' : 'create'),
      clientId: previous?.clientId ?? exact?.id ?? null,
      suggestion,
    });
  }

  const clientNames = [...byKey.values()];
  const issues: ColumnIssue[] = [];

  const unmatched = unmatchedClientsIssue(clientNames);
  if (unmatched) issues.push(unmatched);

  if (multiCells.length > 0) {
    issues.push(
      issue(
        'relation',
        `${multiCells.length} célula(s) têm mais de um cliente; só o primeiro foi mantido. Para guardar todos, mude o tipo para Tags.`,
        multiCells,
      ),
    );
  }

  return { clientNames, issues };
}
