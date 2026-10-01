import { ForecastService, MonthlyForecast } from './forecast.service';
import { IncomesService } from '../incomes/incomes.service';
import { InstallmentPlansService } from '../installment-plans/installment-plans.service';
import { RecurringMaterializationService } from '../recurring-materialization/recurring-materialization.service';
import { PaymentMethodsService } from '../payment-methods/payment-methods.service';
import { MAX_PLANNING_HORIZON_MONTHS } from '../common/constants/recurring-horizon';
import { shiftYearMonth } from '../common/utils/parse-year-month';
import { Types } from 'mongoose';

function forecast(yearMonth: string): MonthlyForecast {
  return {
    boardId: 'board-1',
    yearMonth,
    currency: 'ARS',
    isFutureMonth: true,
    actual: {
      totalIncomes: 0,
      totalExpenses: 0,
      remaining: 0,
      incomesByCurrency: [],
      expensesByCurrency: [],
    },
    planned: {
      incomes: [],
      fixedExpenses: [],
      installments: [],
      totalIncomes: 0,
      totalOutflows: 0,
      projectedRemaining: 3_500_000,
      incomesByCurrency: [],
      outflowsByCurrency: [],
    },
  };
}

describe('ForecastService.getMonthlyForecastRange', () => {
  const ensureHorizon = jest.fn();
  const ensureExpenseOccurrences = jest.fn();
  const boardId = new Types.ObjectId().toString();
  const getMonthlySummaryRange = jest.fn();
  const incomeModel = { find: jest.fn() };
  const expenseModel = { find: jest.fn() };
  let service: ForecastService;
  let computeMonthlyForecast: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    getMonthlySummaryRange.mockImplementation(
      (_board: string, start: string, count: number) =>
        Promise.resolve(
          Array.from({ length: count }, (_, index) => ({
            yearMonth: shiftYearMonth(start, index),
          })),
        ),
    );
    incomeModel.find.mockReturnValue({ lean: jest.fn().mockResolvedValue([]) });
    expenseModel.find.mockReturnValue({
      lean: jest.fn().mockResolvedValue([]),
    });
    service = new ForecastService(
      { getMonthlySummaryRange } as unknown as IncomesService,
      {
        ensureExpenseOccurrences,
      } as unknown as InstallmentPlansService,
      { ensureHorizon } as unknown as RecurringMaterializationService,
      {} as PaymentMethodsService,
      incomeModel as never,
      expenseModel as never,
    );
    computeMonthlyForecast = jest.fn((_boardId: string, yearMonth: string) =>
      Promise.resolve(forecast(yearMonth)),
    );
    (
      service as unknown as {
        computeMonthlyForecast: typeof computeMonthlyForecast;
      }
    ).computeMonthlyForecast = computeMonthlyForecast;
  });

  it('materializes every month requested by a goal beyond the default 12-month window', async () => {
    const result = await service.getMonthlyForecastRange(
      boardId,
      'user-1',
      '2026-09',
      13,
    );

    expect(ensureHorizon).toHaveBeenCalledWith(boardId, 'user-1', 13);
    expect(computeMonthlyForecast).toHaveBeenCalledTimes(13);
    expect(result).toHaveLength(13);
    expect(result.at(-1)?.yearMonth).toBe('2027-09');
    expect(getMonthlySummaryRange).toHaveBeenCalledTimes(1);
    expect(incomeModel.find).toHaveBeenCalledTimes(1);
    expect(expenseModel.find).toHaveBeenCalledTimes(1);
  });

  it('caps long-range materialization at the shared planning horizon', async () => {
    const result = await service.getMonthlyForecastRange(
      boardId,
      'user-1',
      '2026-09',
      MAX_PLANNING_HORIZON_MONTHS + 20,
    );

    expect(ensureHorizon).toHaveBeenCalledWith(
      boardId,
      'user-1',
      MAX_PLANNING_HORIZON_MONTHS,
    );
    expect(result).toHaveLength(MAX_PLANNING_HORIZON_MONTHS);
  });

  it('computes monthly actual and planned totals from batch data without per-month queries', async () => {
    const summaries = ['2026-09', '2026-10'].map((yearMonth) => ({
      boardId,
      yearMonth,
      currency: 'ARS',
      totalIncomes: 1000,
      totalExpenses: 200,
      remaining: 800,
      incomesByCurrency: [],
      expensesByCurrency: [],
    }));
    const incomeFind = jest.fn().mockReturnValue({
      lean: jest.fn().mockResolvedValue([
        {
          _id: new Types.ObjectId(),
          incomeDate: new Date('2026-09-15'),
          amount: 50,
          currency: 'ARS',
          status: 'pending',
          label: 'Extra',
        },
        {
          _id: new Types.ObjectId(),
          incomeDate: new Date('2026-10-01'),
          amount: 500,
          currency: 'ARS',
          status: 'confirmed',
          label: 'Ya confirmado',
        },
      ]),
    });
    const expenseFind = jest.fn().mockReturnValue({
      lean: jest.fn().mockResolvedValue([
        {
          _id: new Types.ObjectId(),
          expenseDate: new Date('2026-09-20'),
          paymentYearMonth: '2026-09',
          amount: 100,
          currency: 'ARS',
          status: 'pending',
        },
        {
          _id: new Types.ObjectId(),
          expenseDate: new Date('2026-10-10'),
          paymentYearMonth: '2026-10',
          amount: 300,
          currency: 'ARS',
          status: 'pending',
        },
        {
          _id: new Types.ObjectId(),
          expenseDate: new Date('2026-10-10'),
          paymentYearMonth: '2026-10',
          amount: 50,
          currency: 'USD',
          status: 'pending',
        },
        {
          _id: new Types.ObjectId(),
          expenseDate: new Date('2026-10-10'),
          paymentYearMonth: '2026-10',
          amount: 500,
          currency: 'ARS',
          status: 'paid',
        },
      ]),
    });
    const incomes = {
      getMonthlySummaryRange: jest.fn().mockResolvedValue(summaries),
      getMonthlySummary: jest.fn(),
    };
    const actual = new ForecastService(
      incomes as never,
      { ensureExpenseOccurrences } as never,
      { ensureHorizon } as never,
      {} as never,
      { find: incomeFind } as never,
      { find: expenseFind } as never,
    );
    const result = await actual.getMonthlyForecastRange(
      boardId,
      'user',
      '2026-09',
      2,
    );
    expect(result.map((f) => f.planned.projectedRemaining)).toEqual([750, 500]);
    expect(result[1].planned.outflowsByCurrency).toEqual([
      expect.objectContaining({ currency: 'USD', total: 50 }),
    ]);
    expect(incomes.getMonthlySummary).not.toHaveBeenCalled();
    expect(incomeFind).toHaveBeenCalledTimes(1);
    expect(expenseFind).toHaveBeenCalledTimes(1);
  });
});
