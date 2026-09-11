import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { IncomesService } from '../incomes/incomes.service';
import { InstallmentPlansService } from '../installment-plans/installment-plans.service';
import { RecurringMaterializationService } from '../recurring-materialization/recurring-materialization.service';
import {
  getCurrentYearMonth,
  parseYearMonth,
  shiftYearMonth,
} from '../common/utils/parse-year-month';
import { splitInstallmentAmounts } from '../common/utils/split-installment-amounts';
import {
  CurrencyBreakdownBuilder,
  CurrencyBreakdownEntry,
} from '../common/utils/currency-breakdown';
import { Income, IncomeDocument, IncomeStatus } from '../incomes/income.schema';
import {
  Expense,
  ExpenseDocument,
  ExpenseStatus,
} from '../expenses/expense.schema';
import { PaymentMethodsService } from '../payment-methods/payment-methods.service';

function getDocumentId(doc: unknown): string {
  const record = doc as { _id?: { toString(): string } };
  return record._id?.toString() ?? '';
}

function getDayFromDate(date: Date): number {
  return date.getUTCDate();
}

export interface ForecastLineItem {
  id: string;
  label: string;
  amount: number;
  currency: string;
  dayOfMonth: number;
  kind: 'recurring-income' | 'recurring-expense' | 'installment';
  status?: 'pending' | 'confirmed' | 'paid';
  meta?: {
    installmentNumber?: number;
    totalInstallments?: number;
    daysOfMonth?: number[];
    paymentMethodId?: string;
    originalAmount?: number;
    originalCurrency?: string;
  };
}

export interface SimulatedExpenseMonth {
  yearMonth: string;
  installmentNumber: number;
  simulatedExpense: number;
  baselineRemaining: number;
  projectedRemaining: number;
  isFutureMonth: boolean;
}

export interface ExpenseSimulationResult {
  label: string;
  totalAmount: number;
  installments: number;
  startYearMonth: string;
  currency: string;
  months: SimulatedExpenseMonth[];
  summary: {
    tightestYearMonth: string;
    lowestProjectedRemaining: number;
    goesNegative: boolean;
  };
}

export interface MonthlyForecast {
  boardId: string;
  yearMonth: string;
  currency: string;
  isFutureMonth: boolean;
  actual: {
    totalIncomes: number;
    totalExpenses: number;
    remaining: number;
    incomesByCurrency: CurrencyBreakdownEntry[];
    expensesByCurrency: CurrencyBreakdownEntry[];
  };
  planned: {
    incomes: ForecastLineItem[];
    fixedExpenses: ForecastLineItem[];
    installments: ForecastLineItem[];
    totalIncomes: number;
    totalOutflows: number;
    projectedRemaining: number;
    incomesByCurrency: CurrencyBreakdownEntry[];
    outflowsByCurrency: CurrencyBreakdownEntry[];
  };
}

@Injectable()
export class ForecastService {
  constructor(
    private incomesService: IncomesService,
    private installmentPlansService: InstallmentPlansService,
    private materializationService: RecurringMaterializationService,
    private paymentMethodsService: PaymentMethodsService,
    @InjectModel(Income.name)
    private incomeModel: Model<IncomeDocument>,
    @InjectModel(Expense.name)
    private expenseModel: Model<ExpenseDocument>,
  ) {}

  async getMonthlyForecast(
    boardId: string,
    yearMonth: string,
    userId: string,
  ): Promise<MonthlyForecast> {
    await this.materializationService.ensureHorizon(boardId, userId);
    await this.installmentPlansService.ensureExpenseOccurrences(
      boardId,
      userId,
    );

    const actualSummary = await this.incomesService.getMonthlySummary(
      boardId,
      yearMonth,
      userId,
    );

    const boardCurrency = actualSummary.currency;
    const currentYearMonth = getCurrentYearMonth();
    const isFutureMonth = yearMonth > currentYearMonth;

    const { from, toExclusive } = parseYearMonth(yearMonth);
    const dateFilter = {
      $gte: new Date(from),
      $lt: new Date(toExclusive),
    };
    const boardObjectId = new Types.ObjectId(boardId);

    const [materializedIncomes, materializedExpenses] = await Promise.all([
      this.incomeModel
        .find({
          tripId: boardObjectId,
          recurringIncomeId: { $exists: true },
          incomeDate: dateFilter,
          skippedAt: { $exists: false },
        })
        .lean(),
      this.expenseModel
        .find({
          tripId: boardObjectId,
          recurringExpenseId: { $exists: true },
          paymentYearMonth: yearMonth,
          skippedAt: { $exists: false },
        })
        .lean(),
    ]);

    const plannedIncomes: ForecastLineItem[] = [];
    const plannedIncomeTotals = new CurrencyBreakdownBuilder();

    for (const income of materializedIncomes) {
      if (income.status !== IncomeStatus.PENDING) continue;

      plannedIncomeTotals.add(income.currency, income.amount);

      // Each item keeps its own currency — never converted — so the
      // itemized list and the headline total agree on what's actually owed.
      plannedIncomes.push({
        id: getDocumentId(income),
        label: income.label,
        amount: income.amount,
        currency: income.currency,
        dayOfMonth: getDayFromDate(new Date(income.incomeDate)),
        kind: 'recurring-income',
        status: 'pending',
      });
    }

    const plannedFixedExpenses: ForecastLineItem[] = [];
    const plannedFixedTotals = new CurrencyBreakdownBuilder();

    for (const expense of materializedExpenses) {
      if (expense.status !== ExpenseStatus.PENDING) continue;

      plannedFixedTotals.add(expense.currency, expense.amount);

      plannedFixedExpenses.push({
        id: getDocumentId(expense),
        label: expense.description || 'Gasto',
        amount: expense.amount,
        currency: expense.currency,
        dayOfMonth: getDayFromDate(new Date(expense.expenseDate)),
        kind: 'recurring-expense',
        status: 'pending',
      });
    }

    const plannedIncomeTotal = plannedIncomeTotals.totalFor(boardCurrency);
    const plannedFixedTotal = plannedFixedTotals.totalFor(boardCurrency);
    const plannedInstallments: ForecastLineItem[] = [];
    const totalPlannedOutflows = plannedFixedTotal;

    const projectedRemaining =
      actualSummary.remaining + plannedIncomeTotal - totalPlannedOutflows;

    return {
      boardId,
      yearMonth,
      currency: boardCurrency,
      isFutureMonth,
      actual: {
        totalIncomes: actualSummary.totalIncomes,
        totalExpenses: actualSummary.totalExpenses,
        remaining: actualSummary.remaining,
        incomesByCurrency: actualSummary.incomesByCurrency,
        expensesByCurrency: actualSummary.expensesByCurrency,
      },
      planned: {
        incomes: plannedIncomes,
        fixedExpenses: plannedFixedExpenses,
        installments: plannedInstallments,
        totalIncomes: plannedIncomeTotal,
        totalOutflows: totalPlannedOutflows,
        projectedRemaining,
        incomesByCurrency: plannedIncomeTotals.otherThan(boardCurrency),
        outflowsByCurrency: plannedFixedTotals.otherThan(boardCurrency),
      },
    };
  }

  async ensureHorizon(boardId: string, userId: string, monthsAhead?: number) {
    return this.materializationService.ensureHorizon(
      boardId,
      userId,
      monthsAhead,
    );
  }

  async simulateExpense(
    boardId: string,
    userId: string,
    input: {
      label: string;
      totalAmount: number;
      installments?: number;
      startYearMonth?: string;
    },
  ): Promise<ExpenseSimulationResult> {
    const installments = input.installments ?? 1;
    const startYearMonth = input.startYearMonth ?? getCurrentYearMonth();
    const installmentAmounts = splitInstallmentAmounts(
      input.totalAmount,
      installments,
    );

    const months: SimulatedExpenseMonth[] = [];
    let tightestYearMonth = startYearMonth;
    let lowestProjectedRemaining = Number.POSITIVE_INFINITY;
    let currency = 'USD';

    for (let index = 0; index < installments; index++) {
      const yearMonth = shiftYearMonth(startYearMonth, index);
      const forecast = await this.getMonthlyForecast(
        boardId,
        yearMonth,
        userId,
      );
      currency = forecast.currency;

      const simulatedExpense = installmentAmounts[index];
      const baselineRemaining = forecast.planned.projectedRemaining;
      const projectedRemaining = baselineRemaining - simulatedExpense;

      months.push({
        yearMonth,
        installmentNumber: index + 1,
        simulatedExpense,
        baselineRemaining,
        projectedRemaining,
        isFutureMonth: forecast.isFutureMonth,
      });

      if (projectedRemaining < lowestProjectedRemaining) {
        lowestProjectedRemaining = projectedRemaining;
        tightestYearMonth = yearMonth;
      }
    }

    return {
      label: input.label.trim(),
      totalAmount: input.totalAmount,
      installments,
      startYearMonth,
      currency,
      months,
      summary: {
        tightestYearMonth,
        lowestProjectedRemaining,
        goesNegative: lowestProjectedRemaining < 0,
      },
    };
  }
}
