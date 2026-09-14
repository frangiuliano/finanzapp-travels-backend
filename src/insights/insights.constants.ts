/**
 * Centralized, testable thresholds for monthly insight selection. Tune here,
 * never inline in insights-builder.ts.
 */
export const INSIGHTS_CONFIG = {
  /** Hard cap on how many insights a single response can contain. */
  MAX_INSIGHTS: 4,
  /** Minimum |% change| in total expenses to surface the headline insight. */
  MIN_TOTAL_PERCENT_CHANGE: 5,
  /** Minimum |% change| for a category to qualify as biggest increase/decrease. */
  MIN_CATEGORY_PERCENT_CHANGE: 15,
  /**
   * A category swing must also represent at least this share of the current
   * month's total expenses — guards against a tiny category (e.g. $10 -> $50)
   * outranking real movements just because its percent change is huge.
   */
  MIN_CATEGORY_SHARE_OF_TOTAL: 0.03,
} as const;
