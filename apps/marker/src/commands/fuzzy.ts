/**
 * Subsequence matching for the command palette.
 *
 * Substring matching fails the way people actually type: "rotcw" should find
 * "Rotate clockwise", and it does not contain that substring. This matches the
 * query as a subsequence and scores how tightly it landed, so the best match
 * is the one that reads as intended rather than merely the first found.
 *
 * Pure: two strings in, a score and the matched positions out.
 */

export interface FuzzyMatch {
  /** Higher is better. Only meaningful when comparing matches of one query. */
  readonly score: number;
  /** Indices in the haystack that the query matched, for highlighting. */
  readonly indices: number[];
}

/** Runs of adjacent matches are what make a match feel deliberate. */
const ADJACENT_BONUS = 8;

/** Matching the first letter of a word is a strong signal of intent. */
const WORD_START_BONUS = 10;

/** Matching at the very start is stronger still. */
const PREFIX_BONUS = 6;

/** Every unmatched character before the last match dilutes the result. */
const GAP_PENALTY = 1;

const isWordStart = (text: string, index: number): boolean => {
  if (index === 0) return true;
  const previous = text[index - 1];
  return previous === ' ' || previous === '-' || previous === '/' || previous === '+';
};

/**
 * Match `query` against `text`, case-insensitively.
 *
 * Returns null when the query is not a subsequence at all. An empty query
 * matches everything with a score of zero, so an unfiltered list keeps its
 * natural order.
 */
export const fuzzyMatch = (query: string, text: string): FuzzyMatch | null => {
  const needle = query.trim().toLowerCase();
  if (needle === '') return { score: 0, indices: [] };

  const haystack = text.toLowerCase();
  const indices: number[] = [];

  let score = 0;
  let searchFrom = 0;
  let previousIndex = -2;

  for (const character of needle) {
    const found = haystack.indexOf(character, searchFrom);
    if (found === -1) return null;

    if (found === previousIndex + 1) score += ADJACENT_BONUS;
    if (isWordStart(text, found)) score += WORD_START_BONUS;
    if (found === 0) score += PREFIX_BONUS;
    score -= Math.min(found - searchFrom, 10) * GAP_PENALTY;

    indices.push(found);
    previousIndex = found;
    searchFrom = found + 1;
  }

  // A short haystack that used most of its characters beats a long one that
  // happened to contain the same letters.
  score += Math.round((needle.length / haystack.length) * 10);
  return { score, indices };
};

export interface Ranked<T> {
  readonly item: T;
  readonly match: FuzzyMatch;
}

/**
 * Rank items by how well they match, dropping the ones that do not.
 *
 * Ties keep the input order, so an unfiltered palette lists commands the way
 * the registry declares them rather than in an order that shifts as you type.
 */
export const fuzzyRank = <T>(
  query: string,
  items: readonly T[],
  toText: (item: T) => string,
): Ranked<T>[] => {
  const ranked: { item: T; match: FuzzyMatch; order: number }[] = [];

  items.forEach((item, order) => {
    const match = fuzzyMatch(query, toText(item));
    if (match) ranked.push({ item, match, order });
  });

  return ranked
    .sort((a, b) => (b.match.score - a.match.score) || (a.order - b.order))
    .map(({ item, match }) => ({ item, match }));
};
