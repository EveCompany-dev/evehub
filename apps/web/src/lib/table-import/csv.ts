export type CsvDelimiter = ',' | ';' | '\t';

export interface DecodedText {
  text: string;
  encoding: 'utf-8' | 'windows-1252';
  /** Still contains replacement characters or classic UTF-8-read-as-Latin-1 garbage ("Ã©"). */
  suspicious: boolean;
}

function mojibakeCount(text: string): number {
  return (text.match(/�|Ã[-¿]|Â[-¿]/g) ?? []).length;
}

/**
 * Decodes an uploaded CSV. Notion and Google Sheets write UTF-8, but Excel's
 * "CSV" save on Windows is windows-1252 — read as UTF-8 that turns every
 * accent into a replacement character. Falls back to windows-1252 when that
 * is clearly the better reading, and reports when neither is clean.
 */
export function decodeCsvBytes(bytes: Uint8Array): DecodedText {
  const utf8 = new TextDecoder('utf-8').decode(bytes);
  const utf8Bad = mojibakeCount(utf8);
  if (utf8Bad === 0) return { text: utf8, encoding: 'utf-8', suspicious: false };

  const latin = new TextDecoder('windows-1252').decode(bytes);
  const latinBad = mojibakeCount(latin);
  if (latinBad < utf8Bad) return { text: latin, encoding: 'windows-1252', suspicious: latinBad > 0 };
  return { text: utf8, encoding: 'utf-8', suspicious: true };
}

/** Picks the delimiter by which one splits the header line into the most columns (outside quotes). */
export function detectDelimiter(text: string): CsvDelimiter {
  const firstLine = (() => {
    let inQuotes = false;
    for (let i = 0; i < text.length; i += 1) {
      const char = text[i];
      if (char === '"') inQuotes = !inQuotes;
      else if (!inQuotes && (char === '\n' || char === '\r')) return text.slice(0, i);
    }
    return text;
  })();

  const counts: Record<CsvDelimiter, number> = { ',': 0, ';': 0, '\t': 0 };
  let inQuotes = false;
  for (const char of firstLine) {
    if (char === '"') inQuotes = !inQuotes;
    else if (!inQuotes && (char === ',' || char === ';' || char === '\t')) counts[char] += 1;
  }

  let best: CsvDelimiter = ',';
  for (const candidate of [';', '\t'] as const) {
    if (counts[candidate] > counts[best]) best = candidate;
  }
  return best;
}

export interface ParsedCsv {
  rows: string[][];
  delimiter: CsvDelimiter;
  /** The quoted section never closed — the file was cut off or hand-edited. */
  unterminatedQuote: boolean;
}

/**
 * RFC 4180 reader: quoted fields, doubled quotes, newlines inside quotes,
 * CRLF/LF/CR, a leading BOM. Rows that are entirely blank are dropped;
 * ragged rows are kept as they are (the import plan reports them).
 */
export function parseCsv(input: string, delimiter?: CsvDelimiter): ParsedCsv {
  const text = input.replace(/^﻿/, '');
  const sep = delimiter ?? detectDelimiter(text);
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  let sawContent = false;

  const endRow = () => {
    row.push(field);
    rows.push(row);
    row = [];
    field = '';
    sawContent = false;
  };

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i]!;
    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
    } else if (char === '"' && field === '') {
      inQuotes = true;
      sawContent = true;
    } else if (char === sep) {
      row.push(field);
      field = '';
      sawContent = true;
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && text[i + 1] === '\n') i += 1;
      endRow();
    } else {
      field += char;
      sawContent = true;
    }
  }
  if (field !== '' || sawContent || row.length > 0) endRow();

  return {
    rows: rows.filter((cells) => cells.some((cell) => cell.trim() !== '')),
    delimiter: sep,
    unterminatedQuote: inQuotes,
  };
}
