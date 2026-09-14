import { ForecastService, MonthlyForecast } from './forecast.service';
import { IncomesService } from '../incomes/incomes.service';
import { InstallmentPlansService } from '../installment-plans/installment-plans.service';
import { RecurringMaterializationService } from '../recurring-materialization/recurring-materialization.service';
import { PaymentMethodsService } from '../payment-methods/payment-methods.service';
import { MAX_PLANNING_HORIZON_MONTHS } from '../common/constants/recurring-horizon';

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
  let service: ForecastService;
  let computeMonthlyForecast: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new ForecastService(
      {} as IncomesService,
      {
        ensureExpenseOccurrences,
      } as unknown as InstallmentPlansService,
      { ensureHorizon } as unknown as RecurringMaterializationService,
      {} as PaymentMethodsService,
      {} as never,
      {} as never,
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
      'board-1',
      'user-1',
      '2026-09',
      13,
    );

    expect(ensureHorizon).toHaveBeenCalledWith('board-1', 'user-1', 13);
    expect(computeMonthlyForecast).toHaveBeenCalledTimes(13);
    expect(result).toHaveLength(13);
    expect(result.at(-1)?.yearMonth).toBe('2027-09');
  });

  it('caps long-range materialization at the shared planning horizon', async () => {
    const result = await service.getMonthlyForecastRange(
      'board-1',
      'user-1',
      '2026-09',
      MAX_PLANNING_HORIZON_MONTHS + 20,
    );

    expect(ensureHorizon).toHaveBeenCalledWith(
      'board-1',
      'user-1',
      MAX_PLANNING_HORIZON_MONTHS,
    );
    expect(result).toHaveLength(MAX_PLANNING_HORIZON_MONTHS);
  });
});
