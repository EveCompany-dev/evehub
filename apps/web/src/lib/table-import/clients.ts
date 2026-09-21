export interface ClientRef {
  id: string;
  label: string;
}

/** Accent-, case- and spacing-insensitive form of a name, for comparing what the CSV says with what the Hub has. */
export function normalizeName(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

const NOTION_LINK = /\s*\(\s*https?:\/\/(?:www\.)?notion\.(?:so|site)\/[^)]*\)/gi;
const HAS_NOTION_LINK = /\(\s*https?:\/\/(?:www\.)?notion\.(?:so|site)\//i;

export function hasNotionLink(text: string): boolean {
  return HAS_NOTION_LINK.test(text);
}

/** "Marcotex (https://www.notion.so/Marcotex-abc123)" -> "Marcotex". */
export function stripNotionLinks(text: string): string {
  return text.replace(NOTION_LINK, '').trim();
}

/**
 * The client names in one relation cell. Notion writes each related page as
 * "Title (https://www.notion.so/...)" joined by commas — commas alone are
 * ambiguous (client names can contain them), so when links are present they
 * are the separators; without links the cell is a single name.
 */
export function relationNames(cell: string): string[] {
  const text = cell.trim();
  if (!text) return [];
  if (!HAS_NOTION_LINK.test(text)) return [text];
  return text
    .split(NOTION_LINK)
    .map((part) => part.replace(/^\s*,\s*/, '').trim())
    .filter(Boolean);
}

// Company-form and connector words that carry no identity ("Ltda", "de").
const STOP_WORDS = new Set(['de', 'da', 'do', 'das', 'dos', 'e', 'a', 'o', 'ltda', 'me', 'eireli', 'sa', 'epp', 'cia']);

function tokens(text: string): string[] {
  return normalizeName(text)
    .split(/[^a-z0-9]+/)
    .filter((token) => token && !STOP_WORDS.has(token));
}

export interface ClientMatch {
  exact: ClientRef | null;
  /** A likely-but-not-certain client ("Marcotex Têxtil" ~ "Marcotex"), for the user to confirm. */
  suggestion: ClientRef | null;
}

export function matchClient(name: string, clients: ClientRef[]): ClientMatch {
  const key = normalizeName(name);
  const exact = clients.find((client) => normalizeName(client.label) === key) ?? null;
  if (exact) return { exact, suggestion: null };

  const mine = tokens(name);
  if (mine.length === 0) return { exact: null, suggestion: null };

  let best: { client: ClientRef; score: number } | null = null;
  for (const client of clients) {
    const theirs = tokens(client.label);
    if (theirs.length === 0) continue;
    const shared = mine.filter((token) => theirs.includes(token));
    if (shared.length === 0) continue;
    // Overlap coefficient: "marcotex" fully inside "marcotex textil" scores 1.
    const score = shared.length / Math.min(mine.length, theirs.length);
    const substantial = shared.some((token) => token.length >= 3);
    if (!substantial || score < 0.5) continue;
    // The leading word is usually the brand; two names that only share a trailing word are unrelated.
    if (mine[0] !== theirs[0] && !theirs.includes(mine[0]!) && !mine.includes(theirs[0]!)) continue;
    const tighter = best ? Math.abs(theirs.length - mine.length) < Math.abs(tokens(best.client.label).length - mine.length) : true;
    if (!best || score > best.score || (score === best.score && tighter)) best = { client, score };
  }
  return { exact: null, suggestion: best?.client ?? null };
}
