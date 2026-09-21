/**
 * Date handling for table cells. Date columns keep whatever text they were
 * given ("31/08/2026", "11/09", "15 de setembro de 2026"...) — Notion exports
 * dates in the workspace's own format, and rewriting them would silently
 * change what the team wrote. The calendar view and the import checks need to
 * *read* those strings, though, which is what parseLooseDate is for.
 */

const PT_MONTHS = [
  'janeiro',
  'fevereiro',
  'marco',
  'abril',
  'maio',
  'junho',
  'julho',
  'agosto',
  'setembro',
  'outubro',
  'novembro',
  'dezembro',
];

const EN_MONTHS = [
  'january',
  'february',
  'march',
  'april',
  'may',
  'june',
  'july',
  'august',
  'september',
  'october',
  'november',
  'december',
];

function strip(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
}

/** Month index (0-11) for a pt/en month name or its 3-letter abbreviation, else -1. */
function monthFromName(name: string): number {
  const key = strip(name).replace(/\.$/, '');
  if (key.length < 3) return -1;
  for (const list of [PT_MONTHS, EN_MONTHS]) {
    const index = list.findIndex((month) => month === key || (key.length === 3 && month.startsWith(key)));
    if (index >= 0) return index;
  }
  return -1;
}

function validDate(year: number, month: number, day: number): Date | null {
  const date = new Date(year, month, day);
  if (date.getFullYear() !== year || date.getMonth() !== month || date.getDate() !== day) return null;
  return date;
}

function expandYear(value: string): number {
  const year = Number(value);
  if (value.length === 4) return year;
  return year >= 70 ? 1900 + year : 2000 + year;
}

const TIME_TAIL = String.raw`(?:[ T]+\d{1,2}:\d{2}(?::\d{2})?(?:\s?[APap][Mm])?(?:\s?(?:Z|[+-]\d{2}:?\d{2}))?)?`;

/**
 * Reads the start of a date written in any format we expect in this workspace
 * (day-first — this is a pt-BR shop — plus ISO and English long dates).
 * Returns null for anything that isn't clearly a date, so free text like
 * "não vamos" or "-" is never mistaken for one. A date with no year
 * ("11/09") takes the year of `ref`.
 */
export function parseLooseDate(input: string, ref: Date = new Date()): Date | null {
  let text = input.trim().replace(/^@/, '');
  if (!text) return null;

  // Notion ranges: "15/09/2026 → 20/09/2026" — the start is what places it.
  const range = text.split(/\s+(?:→|->|—|–)\s+/);
  if (range.length > 1) text = range[0]!.trim();

  let match = new RegExp(String.raw`^(\d{4})-(\d{2})-(\d{2})${TIME_TAIL}$`).exec(text);
  if (match) return validDate(Number(match[1]), Number(match[2]) - 1, Number(match[3]));

  match = new RegExp(String.raw`^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})${TIME_TAIL}$`).exec(text);
  if (match) return validDate(expandYear(match[3]!), Number(match[2]) - 1, Number(match[1]));

  // Only "/" for the year-less form: "1.5" or "10-12" are far more often numbers/ranges than dates.
  match = /^(\d{1,2})\/(\d{1,2})$/.exec(text);
  if (match) return validDate(ref.getFullYear(), Number(match[2]) - 1, Number(match[1]));

  // "15 de setembro de 2026", "15 set 2026", "15 de setembro"
  match = new RegExp(String.raw`^(\d{1,2})(?:\s+de|\s)\s*([\p{L}.]+)(?:(?:\s+de|\s)\s*(\d{4}))?${TIME_TAIL}$`, 'u').exec(text);
  if (match) {
    const month = monthFromName(match[2]!);
    if (month >= 0) return validDate(match[3] ? Number(match[3]) : ref.getFullYear(), month, Number(match[1]));
  }

  // "September 15, 2026", "Sep 15 2026"
  match = new RegExp(String.raw`^([\p{L}.]+)\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})${TIME_TAIL}$`, 'u').exec(text);
  if (match) {
    const month = monthFromName(match[1]!);
    if (month >= 0) return validDate(Number(match[3]), month, Number(match[2]));
  }

  return null;
}

export function looksLikeDate(input: string): boolean {
  return parseLooseDate(input) !== null;
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

/** yyyy-mm-dd in local time (never toISOString — that shifts the day across the UTC boundary). */
export function toIsoDate(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** dd/mm/yyyy — how the team writes dates. */
export function toBrDate(date: Date): string {
  return `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()}`;
}

/**
 * What a date cell shows. Machine-written ISO dates (the date picker, older
 * tables) read as dd/mm/yyyy; everything else is shown exactly as stored.
 */
export function displayDate(value: string): string {
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!iso) return value;
  return `${iso[3]}/${iso[2]}/${iso[1]}`;
}

export function sameCalendarDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

/**
 * Written like a numeric date (dd/mm/yyyy, mm/dd/yyyy, dd-mm-yy...) whether or
 * not it's a real one under day-first reading. Lets the import treat a column
 * with a stray US-style "09/15/2026" as a date column with one bad value,
 * rather than giving up and calling the whole column text.
 */
export function isDateShaped(input: string): boolean {
  return /^\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}(\s.*)?$/.test(input.trim());
}
