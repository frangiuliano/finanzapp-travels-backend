export type InsightType =
  | 'total_variation'
  | 'category_increase'
  | 'category_decrease'
  | 'category_new'
  | 'installment_started'
  | 'installment_finished'
  | 'projected_variation'
  | 'insufficient_data'
  | 'no_activity'
  | 'future_month';

export type InsightSeverity = 'positive' | 'negative' | 'neutral';

export type MonthStatus = 'complete_past' | 'current_partial' | 'future';

export type ComparisonMode =
  'full_month' | 'same_day_range' | 'projected_vs_plan' | 'none';

export interface Insight {
  /** Stable across identical inputs: `${type}:${boardId}:${yearMonth}:${categoryId ?? 'total'}`. */
  id: string;
  type: InsightType;
  severity: InsightSeverity;
  title: string;
  description: string;
  categoryId: string | null;
  categoryName: string | null;
  /** Populated only for installment_started/installment_finished. */
  installmentPlanId: string | null;
  installmentPlanLabel: string | null;
  /** Always the board's base currency — insights never mix currencies. */
  currency: string;
  currentAmount: number | null;
  previousAmount: number | null;
  absoluteChange: number | null;
  /** Null whenever previousAmount <= 0 (no misleading/infinite percentage). */
  percentChange: number | null;
  currentPeriod: string;
  previousPeriod: string | null;
}

export interface MonthlyInsightsResponse {
  boardId: string;
  currency: string;
  currentPeriod: string;
  previousPeriod: string | null;
  monthStatus: MonthStatus;
  comparisonMode: ComparisonMode;
  insights: Insight[];
}
