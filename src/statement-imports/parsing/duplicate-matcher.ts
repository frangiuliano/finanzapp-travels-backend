/**
 * Duplicate detection for parsed statement lines against already-loaded
 * expenses. Deliberately no fuzzy-matching dependency: amount (exact,
 * small epsilon) plus a nearby date already narrows things down enough
 * for a personal card, so text similarity is only used to pick the best
 * match among candidates, not as a hard gate.
 */

export const DUPLICATE_DATE_WINDOW_DAYS = 3;
export const DUPLICATE_AMOUNT_EPSILON = 0.01;

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

export function findPossibleDuplicate(
  line: DuplicateCheckLine,
  candidates: DuplicateCandidateExpense[],
): DuplicateCandidateExpense | null {
  const lineDate = new Date(`${line.date}T00:00:00.000Z`);
  const lineTokens = normalizeDescriptionTokens(line.description);

  let best: {
    candidate: DuplicateCandidateExpense;
    similarity: number;
  } | null = null;

  for (const candidate of candidates) {
    if (candidate.currency !== line.currency) continue;
    if (Math.abs(candidate.amount - line.amount) > DUPLICATE_AMOUNT_EPSILON) {
      continue;
    }
    const daysDiff =
      Math.abs(candidate.expenseDate.getTime() - lineDate.getTime()) /
      (24 * 60 * 60 * 1000);
    if (daysDiff > DUPLICATE_DATE_WINDOW_DAYS) continue;

    const candidateTokens = normalizeDescriptionTokens(
      `${candidate.description} ${candidate.merchantName ?? ''}`,
    );
    const similarity = jaccardSimilarity(lineTokens, candidateTokens);

    if (!best || similarity > best.similarity) {
      best = { candidate, similarity };
    }
  }

  return best ? best.candidate : null;
}
