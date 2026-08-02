import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { IncomesService } from '../incomes/incomes.service';
import { InstallmentPlansService } from '../installment-plans/installment-plans.service';
import { RecurringMaterializationService } from '../recurring-materialization/recurring-materialization.service';
import { getInstallmentDueInMonth } from '../common/utils/installment-schedule';
import {
  getCurrentYearMonth,
  parseYearMonth,
  shiftYearMonth,
} from '../common/utils/parse-year-month';
import { splitInstallmentAmounts } from '../common/utils/split-installment-amounts';
import { Income, IncomeDocument, IncomeStatus } from '../incomes/income.schema';
import {
  Expense,
  ExpenseDocument,
  ExpenseStatus,
} from '../expenses/expense.schema';
import { getInstallmentAmountInBoardCurrency } from '../common/utils/installment-board-currency';
import { ExpenseFxResolver } from '../fx/expense-fx.resolver';
import { PaymentMethodsService } from '../payment-methods/payment-methods.service';
import { PaymentMethod } from '../payment-methods/payment-method.schema';

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
    private installmentPlansService: InstallmentPlansService,
    private materializationService: RecurringMaterializationService,
    private expenseFxResolver: ExpenseFxResolver,
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

    const actualSummary = await this.incomesService.getMonthlySummary(
      boardId,
      yearMonth,
      userId,
    );

    const installmentPlans =
      await this.installmentPlansService.findActiveByBoard(boardId, userId);

    const paymentMethods =
      await this.paymentMethodsService.findAvailableForBoard(boardId, userId);
    const paymentMethodMap = new Map(
      paymentMethods.map((method) => {
        const record = method as PaymentMethod & { _id: Types.ObjectId };
        return [record._id.toString(), record];
      }),
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
          expenseDate: dateFilter,
          skippedAt: { $exists: false },
        })
        .lean(),
    ]);

    const plannedIncomes: ForecastLineItem[] = [];
    let plannedIncomeTotal = 0;

    for (const income of materializedIncomes) {
      if (income.currency !== boardCurrency) continue;
      if (income.status !== IncomeStatus.PENDING) continue;

      plannedIncomes.push({
        id: getDocumentId(income),
        label: income.label,
        amount: income.amount,
        currency: income.currency,
        dayOfMonth: getDayFromDate(new Date(income.incomeDate)),
        kind: 'recurring-income',
        status: 'pending',
      });

      plannedIncomeTotal += income.amount;
    }

    const plannedFixedExpenses: ForecastLineItem[] = [];
    let plannedFixedTotal = 0;

    for (const expense of materializedExpenses) {
      if (expense.status !== ExpenseStatus.PENDING) continue;

      const paymentMethodId = expense.paymentMethodId?.toString();
      const paymentMethod = paymentMethodId
        ? paymentMethodMap.get(paymentMethodId)
        : undefined;

      const amountInBoard =
        await this.expenseFxResolver.getAmountInBoardCurrency(
          expense,
          boardCurrency,
          paymentMethod
            ? {
                kind: paymentMethod.kind,
                closingDay: paymentMethod.closingDay,
              }
            : null,
        );
      if (amountInBoard == null) continue;

      plannedFixedExpenses.push({
        id: getDocumentId(expense),
        label: expense.description,
        amount: amountInBoard,
        currency: boardCurrency,
        dayOfMonth: getDayFromDate(new Date(expense.expenseDate)),
        kind: 'recurring-expense',
        status: 'pending',
      });

      plannedFixedTotal += amountInBoard;
    }

    const plannedInstallments: ForecastLineItem[] = [];
    let plannedInstallmentTotal = 0;

    for (const plan of installmentPlans) {
      const due = getInstallmentDueInMonth(plan, yearMonth);
      if (!due) continue;

      const amountInBoard = getInstallmentAmountInBoardCurrency(
        plan,
        boardCurrency,
      );
      if (amountInBoard == null) continue;

      plannedInstallmentTotal += amountInBoard;
      plannedInstallments.push({
        id: getDocumentId(plan),
        label: plan.label,
        amount: amountInBoard,
        currency: boardCurrency,
        dayOfMonth: due.dayOfMonth,
        kind: 'installment',
        meta: {
          installmentNumber: due.installmentNumber,
          totalInstallments: plan.totalInstallments,
          originalAmount: due.amount,
          originalCurrency: plan.currency,
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
