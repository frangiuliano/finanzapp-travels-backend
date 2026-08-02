import { Injectable } from '@nestjs/common';
import { IncomesService } from '../incomes/incomes.service';
import { RecurringIncomesService } from '../recurring-incomes/recurring-incomes.service';
import { RecurringExpensesService } from '../recurring-expenses/recurring-expenses.service';
import { InstallmentPlansService } from '../installment-plans/installment-plans.service';
import { getValidDaysInMonth } from '../common/utils/validate-day-of-month';
import { getInstallmentDueInMonth } from '../common/utils/installment-schedule';
import {
  getCurrentYearMonth,
  shiftYearMonth,
} from '../common/utils/parse-year-month';
import { splitInstallmentAmounts } from '../common/utils/split-installment-amounts';

function getDocumentId(doc: unknown): string {
  const record = doc as { _id?: { toString(): string } };
  return record._id?.toString() ?? '';
}

export interface ForecastLineItem {
  id: string;
  label: string;
  amount: number;
  currency: string;
  dayOfMonth: number;
  kind: 'recurring-income' | 'recurring-expense' | 'installment';
  meta?: {
    installmentNumber?: number;
    totalInstallments?: number;
    daysOfMonth?: number[];
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
  };
  planned: {
    incomes: ForecastLineItem[];
    fixedExpenses: ForecastLineItem[];
    installments: ForecastLineItem[];
    totalIncomes: number;
    totalOutflows: number;
    projectedRemaining: number;
  };
}

@Injectable()
export class ForecastService {
  constructor(
    private incomesService: IncomesService,
    private recurringIncomesService: RecurringIncomesService,
    private recurringExpensesService: RecurringExpensesService,
    private installmentPlansService: InstallmentPlansService,
  ) {}

  async getMonthlyForecast(
    boardId: string,
    yearMonth: string,
    userId: string,
  ): Promise<MonthlyForecast> {
    const actualSummary = await this.incomesService.getMonthlySummary(
      boardId,
      yearMonth,
      userId,
    );

    const [recurringIncomes, recurringExpenses, installmentPlans] =
      await Promise.all([
        this.recurringIncomesService.findActiveByBoard(boardId, userId),
        this.recurringExpensesService.findActiveByBoard(boardId, userId),
        this.installmentPlansService.findActiveByBoard(boardId, userId),
      ]);

    const boardCurrency = actualSummary.currency;
    const currentYearMonth = getCurrentYearMonth();
    const isFutureMonth = yearMonth > currentYearMonth;

    const plannedIncomes: ForecastLineItem[] = [];
    let plannedIncomeTotal = 0;

    for (const income of recurringIncomes) {
      if (income.currency !== boardCurrency) continue;

      const validDays = getValidDaysInMonth(income.daysOfMonth, yearMonth);
      if (validDays.length === 0) continue;

      const amount = income.amount * validDays.length;
      plannedIncomeTotal += amount;

      plannedIncomes.push({
        id: getDocumentId(income),
        label: income.label,
        amount,
        currency: income.currency,
        dayOfMonth: validDays[0],
        kind: 'recurring-income',
        meta: {
          daysOfMonth: validDays,
        },
      });
    }

    const plannedFixedExpenses: ForecastLineItem[] = [];
    let plannedFixedTotal = 0;

    for (const expense of recurringExpenses) {
      if (expense.currency !== boardCurrency) continue;

      const validDays = getValidDaysInMonth([expense.dayOfMonth], yearMonth);
      if (validDays.length === 0) continue;

      plannedFixedTotal += expense.amount;
      plannedFixedExpenses.push({
        id: getDocumentId(expense),
        label: expense.label,
        amount: expense.amount,
        currency: expense.currency,
        dayOfMonth: expense.dayOfMonth,
        kind: 'recurring-expense',
      });
    }

    const plannedInstallments: ForecastLineItem[] = [];
    let plannedInstallmentTotal = 0;

    for (const plan of installmentPlans) {
      if (plan.currency !== boardCurrency) continue;

      const due = getInstallmentDueInMonth(plan, yearMonth);
      if (!due) continue;

      plannedInstallmentTotal += due.amount;
      plannedInstallments.push({
        id: getDocumentId(plan),
        label: plan.label,
        amount: due.amount,
        currency: plan.currency,
        dayOfMonth: due.dayOfMonth,
        kind: 'installment',
        meta: {
          installmentNumber: due.installmentNumber,
          totalInstallments: plan.totalInstallments,
        },
      });
    }

    const totalPlannedOutflows = plannedFixedTotal + plannedInstallmentTotal;

    const projectedRemaining = isFutureMonth
      ? plannedIncomeTotal - totalPlannedOutflows
      : actualSummary.remaining +
        plannedIncomeTotal -
        plannedFixedTotal -
        plannedInstallmentTotal;

    return {
      boardId,
      yearMonth,
      currency: boardCurrency,
      isFutureMonth,
      actual: {
        totalIncomes: actualSummary.totalIncomes,
        totalExpenses: actualSummary.totalExpenses,
        remaining: actualSummary.remaining,
      },
      planned: {
        incomes: plannedIncomes,
        fixedExpenses: plannedFixedExpenses,
        installments: plannedInstallments,
        totalIncomes: plannedIncomeTotal,
        totalOutflows: totalPlannedOutflows,
        projectedRemaining,
      },
    };
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
