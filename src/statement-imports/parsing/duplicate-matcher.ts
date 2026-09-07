/**
 * Duplicate detection for parsed statement lines against already-loaded
 * expenses. Deliberately no fuzzy-matching dependency: amount (exact,
 * small epsilon) plus a nearby date already narrows things down enough
 * for a personal card, so text similarity is only used to pick the best
 * match among candidates, not as a hard gate.
 *
 * Two passes:
 *  1. One line ↔ one expense, same as always.
 *  2. For lines that didn't match anything on their own, group them by
 *     "same-ish day + shares wording" and check whether the GROUP's sum
 *     matches one expense — this is the case where the bank splits a
 *     single real-world purchase into several statement lines (e.g. a
 *     food-delivery charge plus a separate tip line). Deliberately only
 *     checks the sum of the whole connected group, not every subset —
 *     keeps this simple and bounded instead of a general subset-sum
 *     search, at the cost of missing a real split buried inside a larger
 *     coincidental cluster (acceptable: this only ever produces a
 *     suggestion the user reviews, never an automatic action).
 */

export const DUPLICATE_DATE_WINDOW_DAYS = 3;
export const DUPLICATE_AMOUNT_EPSILON = 0.01;
export const GROUP_SIMILARITY_THRESHOLD = 0.2;

export interface DuplicateCandidateExpense {
  id: string;
  amount: number;
  currency: string;
  description: string;
  merchantName?: string;
  expenseDate: Date;
}

export interface DuplicateCheckLine {
  date: string; // ISO yyyy-mm-dd
  amount: number;
  currency: string;
  description: string;
}

export interface DuplicateMatch {
  expenseId: string;
  description: string;
  amount: number;
  expenseDate: Date;
}

export function normalizeDescriptionTokens(text: string): Set<string> {
  return new Set(
    text
      .toUpperCase()
      .replace(/[^A-Z0-9Ñ ]/g, ' ')
      .split(/\s+/)
      .filter((word) => word.length > 2 && !/^\d+$/.test(word)),
  );
}

export function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const token of a) {
    if (b.has(token)) intersection += 1;
  }
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

function daysBetween(a: Date, b: Date): number {
  return Math.abs(a.getTime() - b.getTime()) / (24 * 60 * 60 * 1000);
}

function toMatch(candidate: DuplicateCandidateExpense): DuplicateMatch {
  return {
    expenseId: candidate.id,
    description: candidate.description,
    amount: candidate.amount,
    expenseDate: candidate.expenseDate,
  };
}

function findBestUnclaimedMatch(
  amount: number,
  currency: string,
  isWithinWindow: (candidateDate: Date) => boolean,
  tokens: Set<string>,
  candidates: DuplicateCandidateExpense[],
  claimed: Set<string>,
): DuplicateCandidateExpense | null {
  let best: {
    candidate: DuplicateCandidateExpense;
    similarity: number;
  } | null = null;

  for (const candidate of candidates) {
    if (claimed.has(candidate.id)) continue;
    if (candidate.currency !== currency) continue;
    if (Math.abs(candidate.amount - amount) > DUPLICATE_AMOUNT_EPSILON)
      continue;
    if (!isWithinWindow(candidate.expenseDate)) continue;

    const candidateTokens = normalizeDescriptionTokens(
      `${candidate.description} ${candidate.merchantName ?? ''}`,
    );
    const similarity = jaccardSimilarity(tokens, candidateTokens);

    if (!best || similarity > best.similarity) {
      best = { candidate, similarity };
    }
  }

  return best ? best.candidate : null;
}

/**
 * Matches every parsed statement line against the candidate expenses at
 * once (grouping requires seeing the whole set), returning one result
 * per line in the same order, or `null` when nothing matched.
 */
export function matchStatementLines(
  lines: DuplicateCheckLine[],
  candidates: DuplicateCandidateExpense[],
): (DuplicateMatch | null)[] {
  const results: (DuplicateMatch | null)[] = new Array(lines.length).fill(null);
  const claimed = new Set<string>();
  const lineDates = lines.map((line) => new Date(`${line.date}T00:00:00.000Z`));
  const lineTokens = lines.map((line) =>
    normalizeDescriptionTokens(line.description),
  );

  // Pass 1: one line to one expense.
  for (let i = 0; i < lines.length; i++) {
    const match = findBestUnclaimedMatch(
      lines[i].amount,
      lines[i].currency,
      (candidateDate) =>
        daysBetween(candidateDate, lineDates[i]) <= DUPLICATE_DATE_WINDOW_DAYS,
      lineTokens[i],
      candidates,
      claimed,
    );
    if (match) {
      claimed.add(match.id);
      results[i] = toMatch(match);
    }
  }

  // Pass 2: group unmatched lines by closeness in date + wording, then
  // try to match the group's sum against one expense.
  const unmatchedIndices = results
    .map((result, index) => (result === null ? index : -1))
    .filter((index) => index >= 0);
  const visited = new Set<number>();

  for (const start of unmatchedIndices) {
    if (visited.has(start)) continue;

    const group: number[] = [];
    const stack = [start];
    visited.add(start);
    while (stack.length > 0) {
      const current = stack.pop()!;
      group.push(current);
      for (const candidateIndex of unmatchedIndices) {
        if (visited.has(candidateIndex)) continue;
        if (
          daysBetween(lineDates[current], lineDates[candidateIndex]) >
          DUPLICATE_DATE_WINDOW_DAYS
        ) {
          continue;
        }
        const similarity = jaccardSimilarity(
          lineTokens[current],
          lineTokens[candidateIndex],
        );
        if (similarity >= GROUP_SIMILARITY_THRESHOLD) {
          visited.add(candidateIndex);
          stack.push(candidateIndex);
        }
      }
    }

    if (group.length < 2) continue;

    const currency = lines[group[0]].currency;
    if (!group.every((index) => lines[index].currency === currency)) continue;

    const sum = group.reduce((total, index) => total + lines[index].amount, 0);
    const groupDates = group.map((index) => lineDates[index]);
    const groupTokens = group.reduce((tokens, index) => {
      for (const token of lineTokens[index]) tokens.add(token);
      return tokens;
    }, new Set<string>());

    const match = findBestUnclaimedMatch(
      sum,
      currency,
      (candidateDate) =>
        groupDates.some(
          (date) =>
            daysBetween(candidateDate, date) <= DUPLICATE_DATE_WINDOW_DAYS,
        ),
      groupTokens,
      candidates,
      claimed,
    );

    if (match) {
      claimed.add(match.id);
      for (const index of group) {
        results[index] = toMatch(match);
      }
    }
  }

  return results;
}
