import { BoardCalendarReport } from '../reports/reports.service';
import {
  daysInYearMonth,
  getCurrentYearMonth,
  shiftYearMonth,
} from '../common/utils/parse-year-month';
import { INSIGHTS_CONFIG } from './insights.constants';
import {
  ComparisonMode,
  Insight,
  InsightSeverity,
  MonthStatus,
  MonthlyInsightsResponse,
} from './insights.types';

const MONTH_NAMES_ES = [
  'enero',
  'febrero',
  'marzo',
  'abril',
  'mayo',
  'junio',
  'julio',
  'agosto',
  'septiembre',
  'octubre',
  'noviembre',
  'diciembre',
];

/** e.g. "agosto", or "diciembre de 2025" when its year differs from `referenceYearMonth`. */
export function monthLabelEs(
  yearMonth: string,
  referenceYearMonth?: string,
): string {
  const [yearStr, monthStr] = yearMonth.split('-');
  const monthName = MONTH_NAMES_ES[Number(monthStr) - 1];
  const referenceYear = referenceYearMonth?.split('-')[0];
  if (referenceYear && referenceYear !== yearStr) {
    return `${monthName} de ${yearStr}`;
  }
  return monthName;
}

/** Mirrors the frontend's `formatCurrency` (Intl, es-ES, currency style). */
export function formatAmountEs(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat('es-ES', {
      style: 'currency',
      currency,
      maximumFractionDigits: 0,
    }).format(amount);
  } catch {
    return `${amount.toFixed(0)} ${currency}`;
  }
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export interface ComparisonPlan {
  monthStatus: MonthStatus;
  /** The real "today" month — always populated, used as the plan baseline for a future month that already has data. */
  currentYearMonth: string;
  previousYearMonth: string;
  comparisonMode: ComparisonMode;
  /** Cutoff applied to the PREVIOUS month's query when comparisonMode is 'same_day_range'. */
  previousUpToDate?: Date;
}

/**
 * Decides how `yearMonth` should be compared to its predecessor:
 * - future month: no comparison at all (never queried).
 * - current, still-running month: truncate the previous month to the same
 *   elapsed-day window (clamped to that month's real day count) so a partial
 *   month is never compared against a full one.
 * - a fully elapsed past month: compare full month vs full month.
 */
export function resolveComparisonPlan(
  yearMonth: string,
  today: Date = new Date(),
): ComparisonPlan {
  const currentYearMonth = getCurrentYearMonth(today);
  const previousYearMonth = shiftYearMonth(yearMonth, -1);

  if (yearMonth > currentYearMonth) {
    return {
      monthStatus: 'future',
      currentYearMonth,
      previousYearMonth,
      comparisonMode: 'none',
    };
  }

  if (yearMonth === currentYearMonth) {
    const elapsedDay = today.getDate();
    const clampedDay = Math.min(elapsedDay, daysInYearMonth(previousYearMonth));
    const [prevYear, prevMonth] = previousYearMonth.split('-').map(Number);
    const previousUpToDate = new Date(
      prevYear,
      prevMonth - 1,
      clampedDay,
      23,
      59,
      59,
      999,
    );
    return {
      monthStatus: 'current_partial',
      currentYearMonth,
      previousYearMonth,
      comparisonMode: 'same_day_range',
      previousUpToDate,
    };
  }

  return {
    monthStatus: 'complete_past',
    currentYearMonth,
    previousYearMonth,
    comparisonMode: 'full_month',
  };
}

export interface InsightsMeta {
  boardId: string;
  currentYearMonth: string;
  previousYearMonth: string;
  currency: string;
}

export function buildFutureMonthInsight(
  boardId: string,
  yearMonth: string,
): Insight {
  return {
    id: `future_month:${boardId}:${yearMonth}:status`,
    type: 'future_month',
    severity: 'neutral',
    title: 'Mes futuro',
    description:
      'Este es un mes futuro: todavía no hay gastos reales para comparar.',
    categoryId: null,
    categoryName: null,
    installmentPlanId: null,
    installmentPlanLabel: null,
    currency: '',
    currentAmount: null,
    previousAmount: null,
    absoluteChange: null,
    percentChange: null,
    currentPeriod: yearMonth,
    previousPeriod: null,
  };
}

/**
 * A future month that already has materialized data (recurring/installments
 * loaded ahead of time) — the app's own default view (current month + 1) is
 * always in this state. Instead of the plain "future month" placeholder,
 * compare what's already loaded against the current month's own full-month
 * projection (actual so far + still-planned), explicitly framed as a
 * forward-looking projection, never as "you spent X" (nothing has actually
 * been spent yet in a future month).
 */
export function buildProjectedVariationInsight(
  boardId: string,
  currency: string,
  futureYearMonth: string,
  futureAmount: number,
  currentYearMonth: string,
  currentPlanAmount: number,
): Insight {
  const futureLabel = monthLabelEs(futureYearMonth, currentYearMonth);
  const currentLabel = monthLabelEs(currentYearMonth, futureYearMonth);
  const id = `projected_variation:${boardId}:${futureYearMonth}:total`;

  if (currentPlanAmount <= 0) {
    // No misleading percentage against a zero/negative baseline (same rule
    // as every other comparison in this module).
    return {
      id,
      type: 'projected_variation',
      severity: 'neutral',
      title: 'Todavía no hay una proyección con qué comparar',
      description: `${capitalize(currentLabel)} todavía no tiene una proyección de gasto para comparar contra lo que ya cargaste en ${futureLabel}.`,
      categoryId: null,
      categoryName: null,
      installmentPlanId: null,
      installmentPlanLabel: null,
      currency,
      currentAmount: futureAmount,
      previousAmount: currentPlanAmount,
      absoluteChange: null,
      percentChange: null,
      currentPeriod: futureYearMonth,
      previousPeriod: currentYearMonth,
    };
  }

  const absoluteChange = futureAmount - currentPlanAmount;
  const percentChange = (absoluteChange / currentPlanAmount) * 100;

  let title: string;
  let description: string;
  let severity: InsightSeverity;

  if (Math.abs(percentChange) < INSIGHTS_CONFIG.MIN_TOTAL_PERCENT_CHANGE) {
    severity = 'neutral';
    title = `${capitalize(futureLabel)} viene en línea con este mes`;
    description = `Lo que ya tenés cargado para ${futureLabel} (${formatAmountEs(futureAmount, currency)}) está en línea con la proyección de ${currentLabel}, sin diferencias significativas por ahora.`;
  } else if (absoluteChange > 0) {
    severity = 'negative';
    title = `${capitalize(futureLabel)} viene más caro`;
    description = `Según lo que ya tenés cargado, ${futureLabel} va ${round2(percentChange)}% por encima de la proyección de ${currentLabel}: ${formatAmountEs(absoluteChange, currency)} más (todavía puede sumar más gastos).`;
  } else {
    severity = 'positive';
    title = `${capitalize(futureLabel)} viene más liviano`;
    description = `Según lo que ya tenés cargado, ${futureLabel} va ${round2(Math.abs(percentChange))}% por debajo de la proyección de ${currentLabel}: ${formatAmountEs(Math.abs(absoluteChange), currency)} menos (todavía puede sumar más gastos).`;
  }

  return {
    id,
    type: 'projected_variation',
    severity,
    title,
    description,
    categoryId: null,
    categoryName: null,
    installmentPlanId: null,
    installmentPlanLabel: null,
    currency,
    currentAmount: futureAmount,
    previousAmount: currentPlanAmount,
    absoluteChange,
    percentChange: round2(percentChange),
    currentPeriod: futureYearMonth,
    previousPeriod: currentYearMonth,
  };
}

export function buildNoActivityInsight(
  boardId: string,
  yearMonth: string,
  currency: string,
): Insight {
  return {
    id: `no_activity:${boardId}:${yearMonth}:status`,
    type: 'no_activity',
    severity: 'neutral',
    title: 'Sin movimientos',
    description: 'Todavía no registraste movimientos este mes.',
    categoryId: null,
    categoryName: null,
    installmentPlanId: null,
    installmentPlanLabel: null,
    currency,
    currentAmount: null,
    previousAmount: null,
    absoluteChange: null,
    percentChange: null,
    currentPeriod: yearMonth,
    previousPeriod: null,
  };
}

export function buildInsufficientDataInsight(
  boardId: string,
  currentYearMonth: string,
  previousYearMonth: string,
  currency: string,
): Insight {
  return {
    id: `insufficient_data:${boardId}:${currentYearMonth}:status`,
    type: 'insufficient_data',
    severity: 'neutral',
    title: 'Sin datos para comparar',
    description: 'Todavía no hay suficientes datos para comparar este período.',
    categoryId: null,
    categoryName: null,
    installmentPlanId: null,
    installmentPlanLabel: null,
    currency,
    currentAmount: null,
    previousAmount: null,
    absoluteChange: null,
    percentChange: null,
    currentPeriod: currentYearMonth,
    previousPeriod: previousYearMonth,
  };
}

export function buildTotalVariationInsight(
  current: BoardCalendarReport,
  previous: BoardCalendarReport,
  meta: InsightsMeta,
): Insight | null {
  const currentAmount = current.totalExpenses;
  const previousAmount = previous.totalExpenses;
  // Caller guarantees previousAmount > 0 before invoking this builder.
  const absoluteChange = currentAmount - previousAmount;
  const percentChange = (absoluteChange / previousAmount) * 100;
  const previousLabel = monthLabelEs(
    meta.previousYearMonth,
    meta.currentYearMonth,
  );

  let title: string;
  let description: string;
  let severity: InsightSeverity;
  let reportedPercentChange: number | null = round2(percentChange);

  if (currentAmount <= 0) {
    // The whole month was net-covered by refunds — describing this as a
    // "% decrease" would read as a nonsensical >100% drop past zero, so no
    // percentage is reported here, only the raw amounts.
    severity = 'positive';
    reportedPercentChange = null;
    title = 'Tus gastos quedaron cubiertos por devoluciones';
    description = `Este mes tus devoluciones cubrieron todo lo gastado (vs. ${formatAmountEs(previousAmount, meta.currency)} en ${previousLabel}).`;
  } else if (absoluteChange > 0) {
    if (percentChange < INSIGHTS_CONFIG.MIN_TOTAL_PERCENT_CHANGE) return null;
    severity = 'negative';
    title = 'Tus gastos totales subieron';
    description = `Gastaste un ${round2(percentChange)}% más que en ${previousLabel}: ${formatAmountEs(absoluteChange, meta.currency)} adicionales.`;
  } else {
    if (Math.abs(percentChange) < INSIGHTS_CONFIG.MIN_TOTAL_PERCENT_CHANGE) {
      return null;
    }
    severity = 'positive';
    title = 'Tus gastos totales bajaron';
    description = `Gastaste un ${round2(Math.abs(percentChange))}% menos que en ${previousLabel}: ${formatAmountEs(Math.abs(absoluteChange), meta.currency)} menos.`;
  }

  return {
    id: `total_variation:${meta.boardId}:${meta.currentYearMonth}:total`,
    type: 'total_variation',
    severity,
    title,
    description,
    categoryId: null,
    categoryName: null,
    installmentPlanId: null,
    installmentPlanLabel: null,
    currency: meta.currency,
    currentAmount,
    previousAmount,
    absoluteChange,
    percentChange: reportedPercentChange,
    currentPeriod: meta.currentYearMonth,
    previousPeriod: meta.previousYearMonth,
  };
}

function totalInstallmentPercentChange(
  currentTotal: number,
  previousTotal: number,
): number | null {
  if (previousTotal <= 0) return null;
  return round2(((currentTotal - previousTotal) / previousTotal) * 100);
}

/**
 * A plan whose very last cuota (installmentNumber === totalInstallments)
 * lands in this period. currentAmount/previousAmount/absoluteChange carry
 * the board's TOTAL installment spend for each period (not just this plan's
 * cuota) — this is also how "cuánto cambió el total en cuotas" is answered,
 * without a separate insight slot.
 */
export function buildInstallmentFinishedInsight(
  current: BoardCalendarReport,
  previous: BoardCalendarReport,
  meta: InsightsMeta,
): Insight | null {
  const finished = current.installmentActivity.finishedPlans;
  if (finished.length === 0) return null;

  const top = [...finished].sort((a, b) => b.amount - a.amount)[0];
  const extraCount = finished.length - 1;
  const extraSuffix =
    extraCount > 0
      ? ` y ${extraCount} plan${extraCount === 1 ? '' : 'es'} más`
      : '';

  const currentTotal = current.installmentActivity.totalAmount;
  const previousTotal = previous.installmentActivity.totalAmount;

  return {
    id: `installment_finished:${meta.boardId}:${meta.currentYearMonth}:${top.planId}`,
    type: 'installment_finished',
    severity: 'positive',
    title: `Terminaste de pagar ${top.label}`,
    description: `Este mes pagaste la última cuota de ${top.label} (${top.installmentNumber}/${top.totalInstallments})${extraSuffix}: vas a dejar de pagar ${formatAmountEs(top.amount, meta.currency)} por mes.`,
    categoryId: null,
    categoryName: null,
    installmentPlanId: top.planId,
    installmentPlanLabel: top.label,
    currency: meta.currency,
    currentAmount: currentTotal,
    previousAmount: previousTotal,
    absoluteChange: round2(currentTotal - previousTotal),
    percentChange: totalInstallmentPercentChange(currentTotal, previousTotal),
    currentPeriod: meta.currentYearMonth,
    previousPeriod: meta.previousYearMonth,
  };
}

/**
 * A plan whose very first materialized cuota (installmentNumber ===
 * paidInstallments + 1) lands in this period. Same total-amount convention
 * as buildInstallmentFinishedInsight above.
 */
export function buildInstallmentStartedInsight(
  current: BoardCalendarReport,
  previous: BoardCalendarReport,
  meta: InsightsMeta,
): Insight | null {
  const started = current.installmentActivity.startedPlans;
  if (started.length === 0) return null;

  const top = [...started].sort((a, b) => b.amount - a.amount)[0];
  const extraCount = started.length - 1;
  const extraSuffix =
    extraCount > 0
      ? ` y ${extraCount} plan${extraCount === 1 ? '' : 'es'} más`
      : '';

  const currentTotal = current.installmentActivity.totalAmount;
  const previousTotal = previous.installmentActivity.totalAmount;

  return {
    id: `installment_started:${meta.boardId}:${meta.currentYearMonth}:${top.planId}`,
    type: 'installment_started',
    severity: 'neutral',
    title: `Empezaste a pagar ${top.label}`,
    description: `Este mes arrancó ${top.label} (cuota ${top.installmentNumber} de ${top.totalInstallments})${extraSuffix}: se suman ${formatAmountEs(top.amount, meta.currency)} por mes a tus cuotas.`,
    categoryId: null,
    categoryName: null,
    installmentPlanId: top.planId,
    installmentPlanLabel: top.label,
    currency: meta.currency,
    currentAmount: currentTotal,
    previousAmount: previousTotal,
    absoluteChange: round2(currentTotal - previousTotal),
    percentChange: totalInstallmentPercentChange(currentTotal, previousTotal),
    currentPeriod: meta.currentYearMonth,
    previousPeriod: meta.previousYearMonth,
  };
}

export function buildCategoryNewInsight(
  current: BoardCalendarReport,
  previous: BoardCalendarReport,
  meta: InsightsMeta,
): Insight | null {
  const previousTotalsById = new Map(
    previous.byCategory
      .filter((c) => c.categoryId !== null)
      .map((c) => [c.categoryId as string, c.total]),
  );

  const candidates = current.byCategory
    .filter((c) => c.categoryId !== null && c.total > 0)
    .filter((c) => (previousTotalsById.get(c.categoryId as string) ?? 0) <= 0)
    .sort((a, b) => b.total - a.total);

  if (candidates.length === 0) return null;

  const top = candidates[0];
  const extraCount = candidates.length - 1;
  const extraSuffix =
    extraCount > 0
      ? ` y ${extraCount} categoría${extraCount === 1 ? '' : 's'} más`
      : '';

  return {
    id: `category_new:${meta.boardId}:${meta.currentYearMonth}:${top.categoryId}`,
    type: 'category_new',
    severity: 'neutral',
    title: 'Nueva categoría este mes',
    description: `Este mes comenzaste a registrar gastos en ${top.categoryName}${extraSuffix}.`,
    categoryId: top.categoryId,
    categoryName: top.categoryName,
    installmentPlanId: null,
    installmentPlanLabel: null,
    currency: meta.currency,
    currentAmount: top.total,
    previousAmount: 0,
    absoluteChange: top.total,
    percentChange: null,
    currentPeriod: meta.currentYearMonth,
    previousPeriod: meta.previousYearMonth,
  };
}

interface CategorySwing {
  categoryId: string;
  categoryName: string;
  currentAmount: number;
  previousAmount: number;
  absoluteChange: number;
  percentChange: number;
}

function computeCategorySwings(
  current: BoardCalendarReport,
  previous: BoardCalendarReport,
): CategorySwing[] {
  const currentTotalsById = new Map(
    current.byCategory
      .filter((c) => c.categoryId !== null)
      .map((c) => [c.categoryId as string, c]),
  );
  const previousTotalsById = new Map(
    previous.byCategory
      .filter((c) => c.categoryId !== null)
      .map((c) => [c.categoryId as string, c]),
  );
  const totalBase = Math.max(
    Math.abs(current.totalExpenses),
    Math.abs(previous.totalExpenses),
  );

  // Union of both periods' category ids: a category that had real spend last
  // month and none at all this month never appears in current.byCategory
  // (ReportsService only lists categories with at least one expense), but it
  // must still be eligible as the "biggest decrease" — otherwise a category
  // going completely silent would be invisible to this comparison.
  const categoryIds = new Set([
    ...currentTotalsById.keys(),
    ...previousTotalsById.keys(),
  ]);

  const swings: CategorySwing[] = [];
  for (const categoryId of categoryIds) {
    const previousCategory = previousTotalsById.get(categoryId);
    if (!previousCategory || previousCategory.total <= 0) continue;
    const currentCategory = currentTotalsById.get(categoryId);
    const currentAmount = currentCategory?.total ?? 0;
    const categoryName =
      currentCategory?.categoryName ?? previousCategory.categoryName;
    const previousAmount = previousCategory.total;
    const absoluteChange = currentAmount - previousAmount;
    const percentChange = (absoluteChange / previousAmount) * 100;
    if (Math.abs(percentChange) < INSIGHTS_CONFIG.MIN_CATEGORY_PERCENT_CHANGE) {
      continue;
    }
    if (
      totalBase > 0 &&
      Math.abs(absoluteChange) <
        INSIGHTS_CONFIG.MIN_CATEGORY_SHARE_OF_TOTAL * totalBase
    ) {
      continue;
    }
    swings.push({
      categoryId,
      categoryName,
      currentAmount,
      previousAmount,
      absoluteChange,
      percentChange,
    });
  }
  return swings;
}

export function buildCategoryIncreaseInsight(
  current: BoardCalendarReport,
  previous: BoardCalendarReport,
  meta: InsightsMeta,
): Insight | null {
  const increases = computeCategorySwings(current, previous)
    .filter((s) => s.absoluteChange > 0)
    .sort((a, b) => b.absoluteChange - a.absoluteChange);

  if (increases.length === 0) return null;
  const top = increases[0];
  const previousLabel = monthLabelEs(
    meta.previousYearMonth,
    meta.currentYearMonth,
  );

  return {
    id: `category_increase:${meta.boardId}:${meta.currentYearMonth}:${top.categoryId}`,
    type: 'category_increase',
    severity: 'negative',
    title: `${top.categoryName} fue la categoría que más aumentó`,
    description: `Gastaste un ${round2(top.percentChange)}% más en ${top.categoryName} que en ${previousLabel}: ${formatAmountEs(top.absoluteChange, meta.currency)} adicionales.`,
    categoryId: top.categoryId,
    categoryName: top.categoryName,
    installmentPlanId: null,
    installmentPlanLabel: null,
    currency: meta.currency,
    currentAmount: top.currentAmount,
    previousAmount: top.previousAmount,
    absoluteChange: top.absoluteChange,
    percentChange: round2(top.percentChange),
    currentPeriod: meta.currentYearMonth,
    previousPeriod: meta.previousYearMonth,
  };
}

export function buildCategoryDecreaseInsight(
  current: BoardCalendarReport,
  previous: BoardCalendarReport,
  meta: InsightsMeta,
): Insight | null {
  const decreases = computeCategorySwings(current, previous)
    .filter((s) => s.absoluteChange < 0)
    .sort((a, b) => a.absoluteChange - b.absoluteChange);

  if (decreases.length === 0) return null;
  const top = decreases[0];
  const previousLabel = monthLabelEs(
    meta.previousYearMonth,
    meta.currentYearMonth,
  );

  // currentAmount === 0: spending simply stopped — a clean, non-misleading
  // -100%. currentAmount < 0: refunds outweighed new spend, which has no
  // clean percentage reading once it crosses zero (nulled below instead).
  const description =
    top.currentAmount < 0
      ? `En ${top.categoryName} recibiste más devoluciones que gastos nuevos este mes (${previousLabel}: ${formatAmountEs(top.previousAmount, meta.currency)}).`
      : top.currentAmount === 0
        ? `Dejaste de registrar gastos en ${top.categoryName} este mes (${previousLabel}: ${formatAmountEs(top.previousAmount, meta.currency)}).`
        : `Gastaste un ${round2(Math.abs(top.percentChange))}% menos en ${top.categoryName} que en ${previousLabel}: ${formatAmountEs(Math.abs(top.absoluteChange), meta.currency)} menos.`;

  return {
    id: `category_decrease:${meta.boardId}:${meta.currentYearMonth}:${top.categoryId}`,
    type: 'category_decrease',
    severity: 'positive',
    title: `${top.categoryName} fue la categoría que más bajó`,
    description,
    categoryId: top.categoryId,
    categoryName: top.categoryName,
    installmentPlanId: null,
    installmentPlanLabel: null,
    currency: meta.currency,
    currentAmount: top.currentAmount,
    previousAmount: top.previousAmount,
    absoluteChange: top.absoluteChange,
    // Only a strictly negative net (refunds outweighing new spend) has no
    // clean percentage reading — a clean drop to zero is a valid -100%.
    percentChange: top.currentAmount < 0 ? null : round2(top.percentChange),
    currentPeriod: meta.currentYearMonth,
    previousPeriod: meta.previousYearMonth,
  };
}

/**
 * Full decision tree for a non-future month. Callers must already have
 * resolved `monthStatus !== 'future'` and fetched `current`/`previous` via
 * ReportsService before calling this — this function does no I/O.
 */
export function selectMonthlyInsights(
  current: BoardCalendarReport,
  previous: BoardCalendarReport,
  meta: InsightsMeta,
): Insight[] {
  if (current.totalExpenses === 0 && current.totalIncomes === 0) {
    return [
      buildNoActivityInsight(
        meta.boardId,
        meta.currentYearMonth,
        meta.currency,
      ),
    ];
  }

  if (previous.totalExpenses <= 0) {
    return [
      buildInsufficientDataInsight(
        meta.boardId,
        meta.currentYearMonth,
        meta.previousYearMonth,
        meta.currency,
      ),
    ];
  }

  // Priority order when more candidates qualify than MAX_INSIGHTS allows:
  // discrete plan-lifecycle events (a debt finished/started) are treated as
  // more decision-relevant than gradual category drift.
  const insights = [
    buildTotalVariationInsight(current, previous, meta),
    buildInstallmentFinishedInsight(current, previous, meta),
    buildInstallmentStartedInsight(current, previous, meta),
    buildCategoryNewInsight(current, previous, meta),
    buildCategoryIncreaseInsight(current, previous, meta),
    buildCategoryDecreaseInsight(current, previous, meta),
  ].filter((insight): insight is Insight => insight !== null);

  return insights.slice(0, INSIGHTS_CONFIG.MAX_INSIGHTS);
}

export function buildMonthlyInsightsResponse(
  boardId: string,
  currency: string,
  plan: ComparisonPlan,
  yearMonth: string,
  current: BoardCalendarReport | null,
  previous: BoardCalendarReport | null,
): MonthlyInsightsResponse {
  const insights =
    plan.monthStatus === 'future'
      ? [buildFutureMonthInsight(boardId, yearMonth)]
      : selectMonthlyInsights(current!, previous!, {
          boardId,
          currentYearMonth: yearMonth,
          previousYearMonth: plan.previousYearMonth,
          currency,
        });

  return {
    boardId,
    currency,
    currentPeriod: yearMonth,
    previousPeriod:
      plan.monthStatus === 'future' ? null : plan.previousYearMonth,
    monthStatus: plan.monthStatus,
    comparisonMode: plan.comparisonMode,
    insights,
  };
}
