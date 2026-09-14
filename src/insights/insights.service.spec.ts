import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException } from '@nestjs/common';
import { InsightsService } from './insights.service';
import {
  BoardCalendarReport,
  ForbiddenBoardAccessError,
  ReportsService,
} from '../reports/reports.service';
import { ForecastService, MonthlyForecast } from '../forecast/forecast.service';

function report(
  overrides: Partial<BoardCalendarReport> = {},
): BoardCalendarReport {
  return {
    boardId: 'board-1',
    yearMonth: '2026-09',
    currency: 'ARS',
    totalIncomes: 1000,
    totalExpenses: 1000,
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

function forecast(overrides: Partial<MonthlyForecast> = {}): MonthlyForecast {
  return {
    boardId: 'board-1',
    yearMonth: '2026-09',
    currency: 'ARS',
    isFutureMonth: false,
    actual: {
      totalIncomes: 0,
      totalExpenses: 1000,
      remaining: -1000,
      incomesByCurrency: [],
      expensesByCurrency: [],
    },
    planned: {
      incomes: [],
      fixedExpenses: [],
      installments: [],
      totalIncomes: 0,
      totalOutflows: 500,
      projectedRemaining: -1500,
      incomesByCurrency: [],
      outflowsByCurrency: [],
    },
    ...overrides,
  };
}

describe('InsightsService', () => {
  let service: InsightsService;
  const reportsService = {
    getBoardCalendarReport: jest.fn(),
  };
  const forecastService = {
    getMonthlyForecast: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    jest.useFakeTimers().setSystemTime(new Date(2026, 8, 15)); // 2026-09-15

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        InsightsService,
        { provide: ReportsService, useValue: reportsService },
        { provide: ForecastService, useValue: forecastService },
      ],
    }).compile();

    service = module.get(InsightsService);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('queries current and previous month and delegates comparison to the builder', async () => {
    reportsService.getBoardCalendarReport
      .mockResolvedValueOnce(
        report({ yearMonth: '2026-08', totalExpenses: 118, currency: 'USD' }),
      )
      .mockResolvedValueOnce(
        report({ yearMonth: '2026-07', totalExpenses: 100, currency: 'USD' }),
      );

    const response = await service.getMonthlyInsights(
      'board-1',
      '2026-08',
      'user-1',
    );

    expect(reportsService.getBoardCalendarReport).toHaveBeenNthCalledWith(
      1,
      'board-1',
      '2026-08',
      'user-1',
    );
    expect(reportsService.getBoardCalendarReport).toHaveBeenNthCalledWith(
      2,
      'board-1',
      '2026-07',
      'user-1',
      undefined,
    );
    expect(response.currency).toBe('USD');
    expect(response.monthStatus).toBe('complete_past');
    expect(response.insights[0].type).toBe('total_variation');
  });

  it('passes an upToDate cutoff for the previous month when the current month is partial', async () => {
    reportsService.getBoardCalendarReport
      .mockResolvedValueOnce(
        report({ yearMonth: '2026-09', totalExpenses: 500 }),
      )
      .mockResolvedValueOnce(
        report({ yearMonth: '2026-08', totalExpenses: 400 }),
      );

    await service.getMonthlyInsights('board-1', '2026-09', 'user-1');

    const secondCallArgs = reportsService.getBoardCalendarReport.mock
      .calls[1] as [string, string, string, { upToDate: Date } | undefined];
    expect(secondCallArgs[1]).toBe('2026-08');
    expect(secondCallArgs[3]).toEqual({
      upToDate: expect.any(Date),
    });
    expect(secondCallArgs[3]?.upToDate.getDate()).toBe(15);
  });

  it('only queries the current (future) month once and skips comparison entirely', async () => {
    reportsService.getBoardCalendarReport.mockResolvedValueOnce(
      report({
        yearMonth: '2026-12',
        totalExpenses: 0,
        totalIncomes: 0,
        currency: 'ARS',
      }),
    );

    const response = await service.getMonthlyInsights(
      'board-1',
      '2026-12',
      'user-1',
    );

    expect(reportsService.getBoardCalendarReport).toHaveBeenCalledTimes(1);
    expect(forecastService.getMonthlyForecast).not.toHaveBeenCalled();
    expect(response.monthStatus).toBe('future');
    expect(response.insights).toEqual([
      expect.objectContaining({ type: 'future_month' }),
    ]);
  });

  it('compares a future month that already has materialized data against the current month plan (the app default view)', async () => {
    // "today" is 2026-09-15; 2026-10 (current+1, the app's default view)
    // already has recurring/installments materialized.
    reportsService.getBoardCalendarReport.mockResolvedValueOnce(
      report({ yearMonth: '2026-10', totalExpenses: 1800, currency: 'ARS' }),
    );
    forecastService.getMonthlyForecast.mockResolvedValueOnce(
      forecast({
        yearMonth: '2026-09',
        actual: {
          totalIncomes: 0,
          totalExpenses: 1000,
          remaining: -1000,
          incomesByCurrency: [],
          expensesByCurrency: [],
        },
        planned: {
          incomes: [],
          fixedExpenses: [],
          installments: [],
          totalIncomes: 0,
          totalOutflows: 500, // current month plan total = 1000 + 500 = 1500
          projectedRemaining: -1500,
          incomesByCurrency: [],
          outflowsByCurrency: [],
        },
      }),
    );

    const response = await service.getMonthlyInsights(
      'board-1',
      '2026-10',
      'user-1',
    );

    expect(reportsService.getBoardCalendarReport).toHaveBeenCalledTimes(1);
    expect(forecastService.getMonthlyForecast).toHaveBeenCalledWith(
      'board-1',
      '2026-09',
      'user-1',
    );
    expect(response.monthStatus).toBe('future');
    expect(response.comparisonMode).toBe('projected_vs_plan');
    expect(response.previousPeriod).toBe('2026-09');
    expect(response.insights).toHaveLength(1);
    expect(response.insights[0].type).toBe('projected_variation');
    expect(response.insights[0].currentAmount).toBe(1800);
    expect(response.insights[0].previousAmount).toBe(1500);
    // (1800 - 1500) / 1500 = +20%
    expect(response.insights[0].percentChange).toBe(20);
    expect(response.insights[0].severity).toBe('negative');
  });

  it('chains a further-out future month against its own immediately preceding month, not always against today', async () => {
    // "today" is 2026-09-15. Requesting 2026-11 must compare against 2026-10
    // (its own predecessor) via a plain ReportsService call — NOT against
    // 2026-09's forecast plan every time, and NOT against 2026-09 at all.
    reportsService.getBoardCalendarReport
      .mockResolvedValueOnce(
        report({ yearMonth: '2026-11', totalExpenses: 500 }),
      )
      .mockResolvedValueOnce(
        report({ yearMonth: '2026-10', totalExpenses: 400 }),
      );

    const response = await service.getMonthlyInsights(
      'board-1',
      '2026-11',
      'user-1',
    );

    expect(forecastService.getMonthlyForecast).not.toHaveBeenCalled();
    expect(reportsService.getBoardCalendarReport).toHaveBeenNthCalledWith(
      2,
      'board-1',
      '2026-10',
      'user-1',
    );
    expect(response.previousPeriod).toBe('2026-10');
    expect(response.insights[0].previousAmount).toBe(400);
    expect(response.insights[0].currentAmount).toBe(500);
  });

  it('does not describe the projected future-month comparison as actual past spending', async () => {
    reportsService.getBoardCalendarReport.mockResolvedValueOnce(
      report({ yearMonth: '2026-10', totalExpenses: 500 }),
    );
    forecastService.getMonthlyForecast.mockResolvedValueOnce(
      forecast({
        actual: {
          totalIncomes: 0,
          totalExpenses: 1000,
          remaining: -1000,
          incomesByCurrency: [],
          expensesByCurrency: [],
        },
        planned: {
          incomes: [],
          fixedExpenses: [],
          installments: [],
          totalIncomes: 0,
          totalOutflows: 0,
          projectedRemaining: -1000,
          incomesByCurrency: [],
          outflowsByCurrency: [],
        },
      }),
    );

    const response = await service.getMonthlyInsights(
      'board-1',
      '2026-10',
      'user-1',
    );

    expect(response.insights[0].description).not.toMatch(/gastaste/i);
  });

  it('propagates authorization errors from ReportsService unchanged', async () => {
    reportsService.getBoardCalendarReport.mockRejectedValue(
      new ForbiddenException('No tienes acceso'),
    );

    await expect(
      service.getMonthlyInsights('board-1', '2026-08', 'user-1'),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('propagates board-access errors (e.g. shared-board / consolidated scenarios) unchanged', async () => {
    reportsService.getBoardCalendarReport.mockRejectedValue(
      new ForbiddenBoardAccessError(['other-board']),
    );

    await expect(
      service.getMonthlyInsights('board-1', '2026-08', 'user-1'),
    ).rejects.toBeInstanceOf(ForbiddenBoardAccessError);
  });

  it('reflects numbers already attributed by ReportsService for a travel-linked board without recomputing them', async () => {
    // ReportsService is the one that knows about linked-travel attribution;
    // InsightsService must just trust whatever totals it returns.
    reportsService.getBoardCalendarReport
      .mockResolvedValueOnce(
        report({
          yearMonth: '2026-08',
          totalExpenses: 5000,
          byCategory: [
            {
              categoryId: 'cat-travel-food',
              categoryName: 'Comida',
              total: 5000,
              count: 2,
              otherCurrencyTotals: [],
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        report({
          yearMonth: '2026-07',
          totalExpenses: 1000,
          byCategory: [
            {
              categoryId: 'cat-travel-food',
              categoryName: 'Comida',
              total: 1000,
              count: 1,
              otherCurrencyTotals: [],
            },
          ],
        }),
      );

    const response = await service.getMonthlyInsights(
      'board-1',
      '2026-08',
      'user-1',
    );

    const categoryInsight = response.insights.find(
      (i) => i.type === 'category_increase',
    );
    expect(categoryInsight?.categoryName).toBe('Comida');
    expect(categoryInsight?.currentAmount).toBe(5000);
  });

  it('handles the December -> January board-report boundary', async () => {
    // "today" is faked to 2026-09-15 in beforeEach, so 2026-01 is a fully
    // elapsed past month and its predecessor correctly rolls back a year.
    reportsService.getBoardCalendarReport
      .mockResolvedValueOnce(
        report({ yearMonth: '2026-01', totalExpenses: 500 }),
      )
      .mockResolvedValueOnce(
        report({ yearMonth: '2025-12', totalExpenses: 1000 }),
      );

    const response = await service.getMonthlyInsights(
      'board-1',
      '2026-01',
      'user-1',
    );

    expect(reportsService.getBoardCalendarReport).toHaveBeenNthCalledWith(
      2,
      'board-1',
      '2025-12',
      'user-1',
      undefined,
    );
    expect(response.previousPeriod).toBe('2025-12');
  });
});
