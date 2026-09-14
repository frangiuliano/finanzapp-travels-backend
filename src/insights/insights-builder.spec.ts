import { BoardCalendarReport } from '../reports/reports.service';
import {
  buildCategoryDecreaseInsight,
  buildCategoryIncreaseInsight,
  buildCategoryNewInsight,
  buildInstallmentFinishedInsight,
  buildInstallmentStartedInsight,
  buildInsufficientDataInsight,
  buildMonthlyInsightsResponse,
  buildNoActivityInsight,
  buildProjectedVariationInsight,
  buildTotalVariationInsight,
  monthLabelEs,
  resolveComparisonPlan,
  selectMonthlyInsights,
} from './insights-builder';
import { InsightsMeta } from './insights-builder';

function report(
  overrides: Partial<BoardCalendarReport> = {},
): BoardCalendarReport {
  return {
    boardId: 'board-1',
    yearMonth: '2026-09',
    currency: 'ARS',
    totalIncomes: 0,
    totalExpenses: 0,
    remaining: 0,
    byCategory: [],
    byPaymentMethod: [],
    incomesByCurrency: [],
    expensesByCurrency: [],
    installmentActivity: {
      totalAmount: 0,
      count: 0,
      startedPlans: [],
      finishedPlans: [],
    },
    ...overrides,
  };
}

const meta: InsightsMeta = {
  boardId: 'board-1',
  currentYearMonth: '2026-09',
  previousYearMonth: '2026-08',
  currency: 'ARS',
};

describe('monthLabelEs', () => {
  it('returns the bare month name when years match', () => {
    expect(monthLabelEs('2026-08', '2026-09')).toBe('agosto');
  });

  it('appends the year when it differs from the reference', () => {
    expect(monthLabelEs('2025-12', '2026-01')).toBe('diciembre de 2025');
  });
});

describe('resolveComparisonPlan', () => {
  const today = new Date(2026, 8, 15); // 2026-09-15

  it('marks a month after today as future, with no comparison', () => {
    const plan = resolveComparisonPlan('2026-10', today);
    expect(plan.monthStatus).toBe('future');
    expect(plan.comparisonMode).toBe('none');
  });

  it('marks a fully elapsed past month for a full-month comparison', () => {
    const plan = resolveComparisonPlan('2026-08', today);
    expect(plan.monthStatus).toBe('complete_past');
    expect(plan.comparisonMode).toBe('full_month');
    expect(plan.previousYearMonth).toBe('2026-07');
    expect(plan.previousUpToDate).toBeUndefined();
  });

  it('truncates the previous month to the same elapsed-day window for the current partial month', () => {
    const plan = resolveComparisonPlan('2026-09', today);
    expect(plan.monthStatus).toBe('current_partial');
    expect(plan.comparisonMode).toBe('same_day_range');
    expect(plan.previousYearMonth).toBe('2026-08');
    expect(plan.previousUpToDate?.getDate()).toBe(15);
    expect(plan.previousUpToDate?.getMonth()).toBe(7); // August (0-indexed)
  });

  it('clamps the cutoff day to the previous month real day count', () => {
    const endOfMonth = new Date(2026, 9, 31); // 2026-10-31 (October has 31 days)
    const plan = resolveComparisonPlan('2026-10', endOfMonth);
    // September (previous month) only has 30 days.
    expect(plan.previousUpToDate?.getDate()).toBe(30);
    expect(plan.previousUpToDate?.getMonth()).toBe(8); // September
  });

  it('rolls December -> January across years', () => {
    const plan = resolveComparisonPlan('2026-01', new Date(2026, 0, 10));
    expect(plan.previousYearMonth).toBe('2025-12');
  });
});

describe('selectMonthlyInsights — priority tree', () => {
  it('returns only no_activity when the current period has no expenses or incomes', () => {
    const current = report({ totalExpenses: 0, totalIncomes: 0 });
    const previous = report({ totalExpenses: 500, totalIncomes: 1000 });

    const insights = selectMonthlyInsights(current, previous, meta);

    expect(insights).toHaveLength(1);
    expect(insights[0].type).toBe('no_activity');
  });

  it('returns only insufficient_data when the previous month has no expenses', () => {
    const current = report({ totalExpenses: 1000, totalIncomes: 1000 });
    const previous = report({ totalExpenses: 0, totalIncomes: 0 });

    const insights = selectMonthlyInsights(current, previous, meta);

    expect(insights).toHaveLength(1);
    expect(insights[0].type).toBe('insufficient_data');
  });

  it('returns only insufficient_data when the previous month total is negative (heavy refunds)', () => {
    const current = report({ totalExpenses: 1000 });
    const previous = report({ totalExpenses: -50 });

    const insights = selectMonthlyInsights(current, previous, meta);

    expect(insights).toHaveLength(1);
    expect(insights[0].type).toBe('insufficient_data');
  });

  it('caps insights at MAX_INSIGHTS (4) even if more candidates qualify', () => {
    const current = report({
      totalExpenses: 100_000,
      totalIncomes: 1,
      byCategory: [
        {
          categoryId: 'cat-food',
          categoryName: 'Comida',
          total: 40000,
          count: 3,
          otherCurrencyTotals: [],
        },
        {
          categoryId: 'cat-transport',
          categoryName: 'Transporte',
          total: 5000,
          count: 1,
          otherCurrencyTotals: [],
        },
        {
          categoryId: 'cat-health',
          categoryName: 'Salud',
          total: 3000,
          count: 1,
          otherCurrencyTotals: [],
        },
      ],
    });
    const previous = report({
      totalExpenses: 80000,
      totalIncomes: 1,
      byCategory: [
        {
          categoryId: 'cat-food',
          categoryName: 'Comida',
          total: 20000,
          count: 3,
          otherCurrencyTotals: [],
        },
        {
          categoryId: 'cat-transport',
          categoryName: 'Transporte',
          total: 20000,
          count: 1,
          otherCurrencyTotals: [],
        },
      ],
    });

    const insights = selectMonthlyInsights(current, previous, meta);

    expect(insights.length).toBeLessThanOrEqual(4);
    const types = insights.map((i) => i.type);
    expect(types).toContain('total_variation');
    expect(types).toContain('category_new');
    expect(types).toContain('category_increase');
    expect(types).toContain('category_decrease');
  });

  it('prioritizes installment lifecycle events over category drift when more than 4 candidates qualify', () => {
    const current = report({
      totalExpenses: 100000,
      totalIncomes: 1,
      byCategory: [
        {
          categoryId: 'cat-food',
          categoryName: 'Comida',
          total: 40000,
          count: 3,
          otherCurrencyTotals: [],
        },
        {
          categoryId: 'cat-transport',
          categoryName: 'Transporte',
          total: 5000,
          count: 1,
          otherCurrencyTotals: [],
        },
        {
          categoryId: 'cat-health',
          categoryName: 'Salud',
          total: 3000,
          count: 1,
          otherCurrencyTotals: [],
        },
      ],
      installmentActivity: {
        totalAmount: 8000,
        count: 1,
        startedPlans: [],
        finishedPlans: [
          {
            planId: 'plan-1',
            label: 'Heladera',
            amount: 8000,
            installmentNumber: 12,
            totalInstallments: 12,
          },
        ],
      },
    });
    const previous = report({
      totalExpenses: 80000,
      totalIncomes: 1,
      byCategory: [
        {
          categoryId: 'cat-food',
          categoryName: 'Comida',
          total: 20000,
          count: 3,
          otherCurrencyTotals: [],
        },
        {
          categoryId: 'cat-transport',
          categoryName: 'Transporte',
          total: 20000,
          count: 1,
          otherCurrencyTotals: [],
        },
      ],
      installmentActivity: {
        totalAmount: 8000,
        count: 1,
        startedPlans: [],
        finishedPlans: [],
      },
    });

    const insights = selectMonthlyInsights(current, previous, meta);
    const types = insights.map((i) => i.type);

    expect(insights).toHaveLength(4);
    expect(types).toEqual([
      'total_variation',
      'installment_finished',
      'category_new',
      'category_increase',
    ]);
    // category_decrease (Transporte) qualifies too but loses its slot to the installment event.
    expect(types).not.toContain('category_decrease');
  });
});

describe('buildTotalVariationInsight', () => {
  it('reports a positive % increase with the additional amount', () => {
    const current = report({ totalExpenses: 118 });
    const previous = report({ totalExpenses: 100 });

    const insight = buildTotalVariationInsight(current, previous, meta);

    expect(insight?.type).toBe('total_variation');
    expect(insight?.severity).toBe('negative');
    expect(insight?.percentChange).toBe(18);
    expect(insight?.absoluteChange).toBe(18);
  });

  it('reports a decrease as positive severity', () => {
    const current = report({ totalExpenses: 88 });
    const previous = report({ totalExpenses: 100 });

    const insight = buildTotalVariationInsight(current, previous, meta);

    expect(insight?.severity).toBe('positive');
    expect(insight?.percentChange).toBe(-12);
  });

  it('suppresses the insight when the change is below the threshold', () => {
    const current = report({ totalExpenses: 102 });
    const previous = report({ totalExpenses: 100 });

    const insight = buildTotalVariationInsight(current, previous, meta);

    expect(insight).toBeNull();
  });

  it('describes a net-refund month without a misleading percentage', () => {
    const current = report({ totalExpenses: -20 });
    const previous = report({ totalExpenses: 100 });

    const insight = buildTotalVariationInsight(current, previous, meta);

    expect(insight?.severity).toBe('positive');
    expect(insight?.percentChange).toBeNull();
    expect(insight?.description).toMatch(/devoluciones/i);
  });
});

describe('buildInstallmentFinishedInsight / buildInstallmentStartedInsight', () => {
  it('reports the plan whose last cuota fell in this period, using the board-wide installment total for the amounts', () => {
    const current = report({
      installmentActivity: {
        totalAmount: 5000,
        count: 2,
        startedPlans: [],
        finishedPlans: [
          {
            planId: 'plan-1',
            label: 'Heladera',
            amount: 8000,
            installmentNumber: 12,
            totalInstallments: 12,
          },
        ],
      },
    });
    const previous = report({
      installmentActivity: {
        totalAmount: 13000,
        count: 3,
        startedPlans: [],
        finishedPlans: [],
      },
    });

    const insight = buildInstallmentFinishedInsight(current, previous, meta);

    expect(insight?.type).toBe('installment_finished');
    expect(insight?.severity).toBe('positive');
    expect(insight?.installmentPlanId).toBe('plan-1');
    expect(insight?.installmentPlanLabel).toBe('Heladera');
    expect(insight?.title).toContain('Heladera');
    expect(insight?.description).toMatch(/12\/12/);
    // Uses the board-wide installment totals, not just this plan's cuota.
    expect(insight?.currentAmount).toBe(5000);
    expect(insight?.previousAmount).toBe(13000);
    expect(insight?.absoluteChange).toBe(-8000);
  });

  it('mentions extra finished plans beyond the highlighted one', () => {
    const current = report({
      installmentActivity: {
        totalAmount: 1000,
        count: 2,
        startedPlans: [],
        finishedPlans: [
          {
            planId: 'plan-1',
            label: 'Heladera',
            amount: 8000,
            installmentNumber: 12,
            totalInstallments: 12,
          },
          {
            planId: 'plan-2',
            label: 'Bici',
            amount: 3000,
            installmentNumber: 6,
            totalInstallments: 6,
          },
        ],
      },
    });
    const previous = report();

    const insight = buildInstallmentFinishedInsight(current, previous, meta);

    expect(insight?.installmentPlanLabel).toBe('Heladera');
    expect(insight?.description).toMatch(/y 1 plan más/);
  });

  it('returns null when nothing finished this period', () => {
    const current = report({
      installmentActivity: {
        totalAmount: 0,
        count: 0,
        startedPlans: [],
        finishedPlans: [],
      },
    });
    expect(buildInstallmentFinishedInsight(current, report(), meta)).toBeNull();
  });

  it('reports a plan whose first materialized cuota (paidInstallments + 1) fell in this period', () => {
    const current = report({
      installmentActivity: {
        totalAmount: 9000,
        count: 2,
        finishedPlans: [],
        startedPlans: [
          {
            planId: 'plan-3',
            label: 'Notebook',
            amount: 4000,
            installmentNumber: 3,
            totalInstallments: 6,
          },
        ],
      },
    });
    const previous = report({
      installmentActivity: {
        totalAmount: 5000,
        count: 1,
        startedPlans: [],
        finishedPlans: [],
      },
    });

    const insight = buildInstallmentStartedInsight(current, previous, meta);

    expect(insight?.type).toBe('installment_started');
    expect(insight?.severity).toBe('neutral');
    expect(insight?.installmentPlanLabel).toBe('Notebook');
    expect(insight?.description).toMatch(/cuota 3 de 6/);
    expect(insight?.currentAmount).toBe(9000);
    expect(insight?.previousAmount).toBe(5000);
  });

  it('returns null when nothing started this period', () => {
    const current = report({
      installmentActivity: {
        totalAmount: 0,
        count: 0,
        startedPlans: [],
        finishedPlans: [],
      },
    });
    expect(buildInstallmentStartedInsight(current, report(), meta)).toBeNull();
  });
});

describe('buildCategoryNewInsight', () => {
  it('detects a category with zero previous spend and positive current spend', () => {
    const current = report({
      byCategory: [
        {
          categoryId: 'cat-health',
          categoryName: 'Salud',
          total: 5000,
          count: 1,
          otherCurrencyTotals: [],
        },
      ],
    });
    const previous = report({ byCategory: [] });

    const insight = buildCategoryNewInsight(current, previous, meta);

    expect(insight?.type).toBe('category_new');
    expect(insight?.categoryName).toBe('Salud');
    expect(insight?.severity).toBe('neutral');
  });

  it('does not treat a net-negative category (refund with no purchase) as new', () => {
    const current = report({
      byCategory: [
        {
          categoryId: 'cat-health',
          categoryName: 'Salud',
          total: -300,
          count: 1,
          otherCurrencyTotals: [],
        },
      ],
    });
    const previous = report({ byCategory: [] });

    const insight = buildCategoryNewInsight(current, previous, meta);

    expect(insight).toBeNull();
  });

  it('mentions extra new categories beyond the highlighted one', () => {
    const current = report({
      byCategory: [
        {
          categoryId: 'cat-health',
          categoryName: 'Salud',
          total: 5000,
          count: 1,
          otherCurrencyTotals: [],
        },
        {
          categoryId: 'cat-pets',
          categoryName: 'Mascotas',
          total: 1000,
          count: 1,
          otherCurrencyTotals: [],
        },
      ],
    });
    const previous = report({ byCategory: [] });

    const insight = buildCategoryNewInsight(current, previous, meta);

    expect(insight?.categoryName).toBe('Salud');
    expect(insight?.description).toMatch(/y 1 categoría más/);
  });

  it('ignores categories without a categoryId ("Sin categoría")', () => {
    const current = report({
      byCategory: [
        {
          categoryId: null,
          categoryName: 'Sin categoría',
          total: 500,
          count: 1,
          otherCurrencyTotals: [],
        },
      ],
    });
    const previous = report({ byCategory: [] });

    expect(buildCategoryNewInsight(current, previous, meta)).toBeNull();
  });
});

describe('buildCategoryIncreaseInsight / buildCategoryDecreaseInsight', () => {
  it('picks the category with the largest absolute increase above both thresholds', () => {
    const current = report({
      totalExpenses: 100000,
      byCategory: [
        {
          categoryId: 'cat-food',
          categoryName: 'Comida',
          total: 30000,
          count: 1,
          otherCurrencyTotals: [],
        },
        {
          categoryId: 'cat-tiny',
          categoryName: 'Varios',
          total: 210,
          count: 1,
          otherCurrencyTotals: [],
        },
      ],
    });
    const previous = report({
      totalExpenses: 90000,
      byCategory: [
        {
          categoryId: 'cat-food',
          categoryName: 'Comida',
          total: 20000,
          count: 1,
          otherCurrencyTotals: [],
        },
        {
          categoryId: 'cat-tiny',
          categoryName: 'Varios',
          total: 100,
          count: 1,
          otherCurrencyTotals: [],
        },
      ],
    });

    const insight = buildCategoryIncreaseInsight(current, previous, meta);

    // 'Varios' moved +110% but is far below the 3%-of-total share floor; 'Comida' wins.
    expect(insight?.categoryName).toBe('Comida');
    expect(insight?.severity).toBe('negative');
  });

  it('returns null when no category clears both thresholds', () => {
    const current = report({
      totalExpenses: 100000,
      byCategory: [
        {
          categoryId: 'cat-food',
          categoryName: 'Comida',
          total: 20500,
          count: 1,
          otherCurrencyTotals: [],
        },
      ],
    });
    const previous = report({
      totalExpenses: 90000,
      byCategory: [
        {
          categoryId: 'cat-food',
          categoryName: 'Comida',
          total: 20000,
          count: 1,
          otherCurrencyTotals: [],
        },
      ],
    });

    expect(buildCategoryIncreaseInsight(current, previous, meta)).toBeNull();
  });

  it('detects a category that went completely silent (present last month, absent this month) as the biggest decrease', () => {
    const current = report({
      totalExpenses: 100000,
      byCategory: [
        {
          categoryId: 'cat-food',
          categoryName: 'Comida',
          total: 100000,
          count: 5,
          otherCurrencyTotals: [],
        },
      ],
    });
    const previous = report({
      totalExpenses: 100000,
      byCategory: [
        {
          categoryId: 'cat-food',
          categoryName: 'Comida',
          total: 100000,
          count: 5,
          otherCurrencyTotals: [],
        },
        {
          categoryId: 'cat-supermarket',
          categoryName: 'Supermercado',
          total: 35000,
          count: 4,
          otherCurrencyTotals: [],
        },
      ],
    });

    const insight = buildCategoryDecreaseInsight(current, previous, meta);

    expect(insight?.categoryName).toBe('Supermercado');
    expect(insight?.currentAmount).toBe(0);
    expect(insight?.percentChange).toBe(-100);
  });

  it('detects the biggest decrease, phrased as a plain decrease when still positive', () => {
    const current = report({
      totalExpenses: 80000,
      byCategory: [
        {
          categoryId: 'cat-transport',
          categoryName: 'Transporte',
          total: 4000,
          count: 1,
          otherCurrencyTotals: [],
        },
      ],
    });
    const previous = report({
      totalExpenses: 100000,
      byCategory: [
        {
          categoryId: 'cat-transport',
          categoryName: 'Transporte',
          total: 20000,
          count: 1,
          otherCurrencyTotals: [],
        },
      ],
    });

    const insight = buildCategoryDecreaseInsight(current, previous, meta);

    expect(insight?.categoryName).toBe('Transporte');
    expect(insight?.severity).toBe('positive');
    expect(insight?.description).toMatch(/menos/);
    expect(insight?.description).not.toMatch(/devoluciones/i);
  });

  it('phrases a refund-driven negative category total distinctly from a plain decrease', () => {
    const current = report({
      totalExpenses: 80000,
      byCategory: [
        {
          categoryId: 'cat-transport',
          categoryName: 'Transporte',
          total: -500,
          count: 1,
          otherCurrencyTotals: [],
        },
      ],
    });
    const previous = report({
      totalExpenses: 100000,
      byCategory: [
        {
          categoryId: 'cat-transport',
          categoryName: 'Transporte',
          total: 20000,
          count: 1,
          otherCurrencyTotals: [],
        },
      ],
    });

    const insight = buildCategoryDecreaseInsight(current, previous, meta);

    expect(insight?.description).toMatch(/devoluciones/i);
    expect(insight?.description).not.toMatch(/consumo|gastaste/i);
  });
});

describe('buildProjectedVariationInsight', () => {
  it('flags a future month that is already trending above the current month plan', () => {
    const insight = buildProjectedVariationInsight(
      'board-1',
      'ARS',
      '2026-10',
      1800,
      '2026-09',
      1500,
    );

    expect(insight.type).toBe('projected_variation');
    expect(insight.severity).toBe('negative');
    expect(insight.percentChange).toBe(20);
    expect(insight.absoluteChange).toBe(300);
    expect(insight.currentPeriod).toBe('2026-10');
    expect(insight.previousPeriod).toBe('2026-09');
  });

  it('flags a future month trending below the current month plan as positive', () => {
    const insight = buildProjectedVariationInsight(
      'board-1',
      'ARS',
      '2026-10',
      1000,
      '2026-09',
      1500,
    );

    expect(insight.severity).toBe('positive');
    expect(insight.percentChange).toBe(-33.33);
  });

  it('reports "en línea" (neutral) when the difference is below the threshold', () => {
    const insight = buildProjectedVariationInsight(
      'board-1',
      'ARS',
      '2026-10',
      1520,
      '2026-09',
      1500,
    );

    expect(insight.severity).toBe('neutral');
    expect(insight.title).toMatch(/en línea/i);
  });

  it('never phrases the future month as already-spent ("gastaste")', () => {
    const insight = buildProjectedVariationInsight(
      'board-1',
      'ARS',
      '2026-10',
      1800,
      '2026-09',
      1500,
    );

    expect(insight.description).not.toMatch(/gastaste/i);
    expect(insight.title).not.toMatch(/gastaste/i);
  });

  it('nulls the percentage instead of dividing by a zero/negative current-month plan', () => {
    const insight = buildProjectedVariationInsight(
      'board-1',
      'ARS',
      '2026-10',
      1800,
      '2026-09',
      0,
    );

    expect(insight.percentChange).toBeNull();
    expect(insight.absoluteChange).toBeNull();
    expect(insight.severity).toBe('neutral');
  });
});

describe('buildNoActivityInsight / buildInsufficientDataInsight', () => {
  it('produce stable, deterministic ids', () => {
    const a = buildNoActivityInsight('board-1', '2026-09', 'ARS');
    const b = buildNoActivityInsight('board-1', '2026-09', 'ARS');
    expect(a.id).toBe(b.id);

    const c = buildInsufficientDataInsight(
      'board-1',
      '2026-09',
      '2026-08',
      'ARS',
    );
    expect(c.id).toContain('board-1');
    expect(c.description).toBe(
      'Todavía no hay suficientes datos para comparar este período.',
    );
  });
});

describe('buildMonthlyInsightsResponse', () => {
  it('returns only a future_month insight without touching current/previous reports', () => {
    const plan = resolveComparisonPlan('2027-01', new Date(2026, 8, 15));
    const response = buildMonthlyInsightsResponse(
      'board-1',
      'ARS',
      plan,
      '2027-01',
      null,
      null,
    );

    expect(response.monthStatus).toBe('future');
    expect(response.previousPeriod).toBeNull();
    expect(response.insights).toHaveLength(1);
    expect(response.insights[0].type).toBe('future_month');
  });

  it('wires monthStatus/comparisonMode through for a normal comparison', () => {
    const plan = resolveComparisonPlan('2026-08', new Date(2026, 8, 15));
    const current = report({
      yearMonth: '2026-08',
      totalExpenses: 118,
      totalIncomes: 1,
    });
    const previous = report({
      yearMonth: '2026-07',
      totalExpenses: 100,
      totalIncomes: 1,
    });

    const response = buildMonthlyInsightsResponse(
      'board-1',
      'ARS',
      plan,
      '2026-08',
      current,
      previous,
    );

    expect(response.monthStatus).toBe('complete_past');
    expect(response.comparisonMode).toBe('full_month');
    expect(response.previousPeriod).toBe('2026-07');
    expect(response.insights[0].type).toBe('total_variation');
  });
});
