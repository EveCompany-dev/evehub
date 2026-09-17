/**
 * Ranking for the Ctrl+K palette.
 *
 * The palette indexes everything — pages, every individual setting, every
 * connector and module — so with a few hundred entries "contains the typed
 * string" stops being good enough: typing "cur"
 * has to put "Bolinha que segue o cursor" above a note that merely mentions
 * the word, and typing "agd" has to still find "Agenda".
 *
 * So: a subsequence match (every typed character appears in order) with
 * bonuses for matching at a word start and for consecutive runs. Pure and
 * synchronous — the whole index is a few hundred short strings, so there is
 * nothing here worth memoizing beyond what the caller already does.
 */

export interface Searchable {
  label: string;
  /** Shown to the right of the label; also searched, weighted lower. */
  hint?: string;
  /** Synonyms and the words a user would actually type. */
  keywords?: string[];
}

/** Portuguese without the diacritics, so "agenda" matches "Agência" and "conexao" matches "conexão". */
export function fold(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

const NOT_FOUND = -1;

/**
 * Score of `term` against one string, or NOT_FOUND. Higher is better.
 *
 * An exact prefix beats a word-start match, which beats a scattered
 * subsequence — the shape users expect from an editor's fuzzy finder.
 */
export function scoreOne(term: string, text: string): number {
  if (term.length === 0) return 0;

  const haystack = fold(text);
  const needle = fold(term);

  if (haystack === needle) return 1000;
  if (haystack.startsWith(needle)) return 800 - haystack.length;

  const wordStart = haystack.split(/[\s\-_/.,()]+/).some((word) => word.startsWith(needle));
  if (wordStart) return 600 - haystack.length;

  const direct = haystack.indexOf(needle);
  if (direct >= 0) return 400 - direct - haystack.length / 10;

  // Scattered subsequence: every character in order, rewarding runs and
  // word-boundary hits so "dbm" scores on "DashBoard Mode".
  let score = 0;
  let cursor = 0;
  let run = 0;

  for (const char of needle) {
    const found = haystack.indexOf(char, cursor);
    if (found === NOT_FOUND) return NOT_FOUND;

    const atWordStart = found === 0 || /[\s\-_/.,()]/.test(haystack[found - 1] ?? '');
    run = found === cursor ? run + 1 : 0;
    score += 10 + run * 4 + (atWordStart ? 8 : 0);
    cursor = found + 1;
  }

  // Never let a scattered match outrank a substring one.
  return Math.min(score, 200) - haystack.length / 10;
}

/** Best score across label, hint and keywords, with hint/keyword hits discounted. */
export function scoreItem(term: string, item: Searchable): number {
  if (term.length === 0) return 0;

  const scores = [
    scoreOne(term, item.label),
    ...(item.hint ? [scoreOne(term, item.hint) - 120] : []),
    ...(item.keywords ?? []).map((keyword) => scoreOne(term, keyword) - 60),
  ].filter((score) => score > NOT_FOUND);

  return scores.length > 0 ? Math.max(...scores) : NOT_FOUND;
}

export interface RankOptions<T> {
  /** Ids used recently, most recent first: a small nudge, never a reordering of a clear winner. */
  recent?: string[];
  idOf: (item: T) => string;
  limit?: number;
}

/**
 * Ranks `items` against `term`. With an empty term the original order is
 * kept (so the palette opens on a curated list), except that recent entries
 * float to the top — the closest thing to "what I usually do".
 */
export function rank<T extends Searchable>(term: string, items: T[], options: RankOptions<T>): T[] {
  const { recent = [], idOf, limit = 60 } = options;
  const recentRank = new Map(recent.map((id, index) => [id, recent.length - index]));

  if (term.trim().length === 0) {
    const sorted = [...items].sort((a, b) => (recentRank.get(idOf(b)) ?? 0) - (recentRank.get(idOf(a)) ?? 0));
    return sorted.slice(0, limit);
  }

  return items
    .map((item) => ({ item, score: scoreItem(term.trim(), item) + (recentRank.get(idOf(item)) ?? 0) * 3 }))
    .filter((entry) => entry.score > NOT_FOUND)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((entry) => entry.item);
}
