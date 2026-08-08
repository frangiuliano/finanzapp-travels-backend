import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Expense, ExpenseDocument } from '../expenses/expense.schema';
import { Income, IncomeDocument } from '../incomes/income.schema';
import { Category, CategoryDocument } from '../categories/category.schema';
import {
  PaymentMethod,
  PaymentMethodDocument,
  PaymentMethodKind,
} from '../payment-methods/payment-method.schema';
import { ParticipantsService } from '../participants/participants.service';
import { BoardsService } from '../trips/trips.service';
import { PaymentMethodsService } from '../payment-methods/payment-methods.service';
import { BillingPeriodsService } from '../billing-periods/billing-periods.service';
import { Board, BoardType } from '../trips/board.schema';
import { parseYearMonth } from '../common/utils/parse-year-month';
import {
  assertValidCycleLabel,
  getCreditCycleRange,
  getCurrentCycleClosingMonth,
  listRecentCycleLabels,
  resolveCycleClosingMonth,
} from '../common/utils/credit-cycle';
import { DEFAULT_CURRENCY } from '../common/constants/currencies';
import { getExpenseAmountInBoardCurrency } from '../common/utils/expense-board-currency';
import { getPersonalExpenseAmount } from '../common/utils/personal-expense-attribution';

export interface CategoryBreakdownItem {
  categoryId: string | null;
  categoryName: string;
  total: number;
  count: number;
}

export interface PaymentMethodBreakdownItem {
  paymentMethodId: string | null;
  paymentMethodName: string;
  kind: PaymentMethodKind | null;
  total: number;
  count: number;
}

export interface BoardCalendarReport {
  boardId: string;
  yearMonth: string;
  currency: string;
  totalIncomes: number;
  totalExpenses: number;
  remaining: number;
  byCategory: CategoryBreakdownItem[];
  byPaymentMethod: PaymentMethodBreakdownItem[];
  excludedDueToCurrencyMismatch: {
    incomes: number;
    expenses: number;
  };
}

export interface CreditCycleReport {
  status: 'ok';
  boardId: string;
  paymentMethodId: string;
  paymentMethodName: string;
  closingDay: number;
  cycleLabel: string;
  periodFrom: string;
  periodToInclusive: string;
  currency: string;
  totalExpenses: number;
  expenseCount: number;
  availableCycles: string[];
}

export interface CreditCycleClosingDayRequired {
  status: 'closing_day_required';
  boardId: string;
  paymentMethodId: string;
  paymentMethodName: string;
  message: string;
}

export interface ConsolidatedBoardSummary {
  boardId: string;
  boardName: string;
  currency: string;
  totalIncomes: number;
  totalExpenses: number;
  remaining: number;
}

export interface CurrencyTotals {
  totalIncomes: number;
  totalExpenses: number;
  remaining: number;
  boardCount: number;
}

export interface ConsolidatedReport {
  yearMonth: string;
  boards: ConsolidatedBoardSummary[];
  totalsByCurrency: Record<string, CurrencyTotals>;
}

function parseDateFrom(value: string): Date {
  return new Date(value);
}

function addUtcDay(dateStr: string, days: number): string {
  const date = new Date(`${dateStr}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

type BoardListItem = Board & {
  _id: Types.ObjectId;
  linkedEverydayBoardId?: string;
};

function getBoardId(board: BoardListItem): string {
  return board._id.toString();
}

function resolveExpensePaymentMethodId(
  expense: Pick<Expense, 'paymentMethodId' | 'cardId'>,
): string | null {
  const id = expense.paymentMethodId ?? expense.cardId;
  return id ? id.toString() : null;
}

@Injectable()
export class ReportsService {
  private readonly logger = new Logger(ReportsService.name);

  constructor(
    @InjectModel(Expense.name)
    private expenseModel: Model<ExpenseDocument>,
    @InjectModel(Income.name)
    private incomeModel: Model<IncomeDocument>,
    @InjectModel(Category.name)
    private categoryModel: Model<CategoryDocument>,
    @InjectModel(PaymentMethod.name)
    private paymentMethodModel: Model<PaymentMethodDocument>,
    private participantsService: ParticipantsService,
    private boardsService: BoardsService,
    private paymentMethodsService: PaymentMethodsService,
    private billingPeriodsService: BillingPeriodsService,
  ) {}

  async getBoardCalendarReport(
    boardId: string,
    yearMonth: string,
    userId: string,
  ): Promise<BoardCalendarReport> {
    await this.participantsService.ensureParticipantAccess(boardId, userId);
    const board = await this.boardsService.findByIdOrFail(boardId);
    const scopeContext = await this.boardsService.findExpenseScopeContext(
      boardId,
      userId,
    );
    const scopeBoards = scopeContext.map((item) => item.board);
    const boardCurrency = board.baseCurrency ?? DEFAULT_CURRENCY;
    const { from, toExclusive } = parseYearMonth(yearMonth);
    const dateFilter = {
      $gte: parseDateFrom(from),
      $lt: parseDateFrom(toExclusive),
    };
    const boardObjectId = new Types.ObjectId(boardId);
    const boardObjectIds = scopeBoards.map((item) => item._id);

    const [incomes, expenses] = await Promise.all([
      this.incomeModel
        .find({ tripId: boardObjectId, incomeDate: dateFilter })
        .lean(),
      this.expenseModel
        .find({ tripId: { $in: boardObjectIds }, expenseDate: dateFilter })
        .lean(),
    ]);

    let totalIncomes = 0;
    let excludedIncomes = 0;
    for (const income of incomes) {
      if (income.currency === boardCurrency) {
        totalIncomes += income.amount;
      } else {
        excludedIncomes += 1;
      }
    }

    let totalExpenses = 0;
    let excludedExpenses = 0;
    const convertibleExpenses: Expense[] = [];

    const participantByBoardId = new Map(
      scopeContext.map((item) => [
        item.board._id.toString(),
        item.participantId,
      ]),
    );
    const boardTypeById = new Map(
      scopeBoards.map((item) => [item._id.toString(), item.type]),
    );

    for (const sourceExpense of expenses) {
      const sourceBoardId = sourceExpense.tripId?.toString() ?? boardId;
      const isInheritedTravel =
        board.type === BoardType.EVERYDAY &&
        boardTypeById.get(sourceBoardId) === BoardType.TRAVEL;
      const attributedAmount = isInheritedTravel
        ? getPersonalExpenseAmount(
            sourceExpense,
            participantByBoardId.get(sourceBoardId)!,
          )
        : sourceExpense.amount;
      if (attributedAmount <= 0) continue;
      const expense = { ...sourceExpense, amount: attributedAmount };
      const amountInBoardCurrency = getExpenseAmountInBoardCurrency(
        expense,
        boardCurrency,
      );
      if (amountInBoardCurrency == null) {
        excludedExpenses += 1;
        continue;
      }
      totalExpenses += amountInBoardCurrency;
      convertibleExpenses.push(expense);
    }

    const [byCategory, byPaymentMethod] = await Promise.all([
      this.buildCategoryBreakdown(
        boardObjectIds,
        convertibleExpenses,
        boardCurrency,
      ),
      this.buildPaymentMethodBreakdown(convertibleExpenses, boardCurrency),
    ]);

    return {
      boardId,
      yearMonth,
      currency: boardCurrency,
      totalIncomes,
      totalExpenses,
      remaining: totalIncomes - totalExpenses,
      byCategory,
      byPaymentMethod,
      excludedDueToCurrencyMismatch: {
        incomes: excludedIncomes,
        expenses: excludedExpenses,
      },
    };
  }

  async getCreditCycleReport(
    boardId: string,
    paymentMethodId: string,
    cycle: string,
    userId: string,
  ): Promise<CreditCycleReport | CreditCycleClosingDayRequired> {
    await this.participantsService.ensureParticipantAccess(boardId, userId);

    const availableMethods =
      await this.paymentMethodsService.findAvailableForBoard(boardId, userId);
    const paymentMethod = availableMethods.find((item) => {
      const doc = item as PaymentMethod & { _id: Types.ObjectId };
      return doc._id.toString() === paymentMethodId;
    });

    if (!paymentMethod) {
      throw new BadRequestException(
        'El medio de pago no está disponible para este tablero',
      );
    }

    if (paymentMethod.kind !== PaymentMethodKind.CREDIT) {
      throw new BadRequestException(
        'Los reportes por ciclo solo aplican a medios de pago de crédito',
      );
    }

    if (paymentMethod.closingDay == null) {
      return {
        status: 'closing_day_required',
        boardId,
        paymentMethodId,
        paymentMethodName: paymentMethod.name,
        message:
          'Configura el día de cierre de esta tarjeta para ver reportes por ciclo de facturación',
      };
    }

    const cycleLabel =
      cycle === 'current'
        ? getCurrentCycleClosingMonth(paymentMethod.closingDay)
        : cycle;

    if (cycle !== 'current') {
      assertValidCycleLabel(cycleLabel);
    }

    const board = await this.boardsService.findByIdOrFail(boardId);
    const boardCurrency = board.baseCurrency ?? DEFAULT_CURRENCY;

    const confirmedPeriod =
      await this.billingPeriodsService.findConfirmedPeriod(
        paymentMethodId,
        cycleLabel,
      );

    const defaultRange = getCreditCycleRange(
      cycleLabel,
      paymentMethod.closingDay,
    );
    const from = confirmedPeriod?.periodFrom ?? defaultRange.from;
    const periodToInclusive =
      confirmedPeriod?.periodTo ?? defaultRange.periodToInclusive;
    const toExclusive = confirmedPeriod
      ? addUtcDay(periodToInclusive, 1)
      : defaultRange.toExclusive;

    const expenses = await this.expenseModel
      .find({
        tripId: new Types.ObjectId(boardId),
        expenseDate: {
          $gte: parseDateFrom(from),
          $lt: parseDateFrom(toExclusive),
        },
        $or: [
          { paymentMethodId: new Types.ObjectId(paymentMethodId) },
          { cardId: new Types.ObjectId(paymentMethodId) },
        ],
      })
      .lean();

    let totalExpenses = 0;
    let expenseCount = 0;

    for (const expense of expenses) {
      const amountInBoardCurrency = getExpenseAmountInBoardCurrency(
        expense,
        boardCurrency,
      );
      if (amountInBoardCurrency == null) {
        continue;
      }
      totalExpenses += amountInBoardCurrency;
      expenseCount += 1;
    }

    const availableCycles = listRecentCycleLabels(paymentMethod.closingDay, 12);

    this.logger.debug(
      `Credit cycle report board=${boardId} method=${paymentMethodId} cycle=${cycleLabel}`,
    );

    return {
      status: 'ok',
      boardId,
      paymentMethodId,
      paymentMethodName: paymentMethod.name,
      closingDay: paymentMethod.closingDay,
      cycleLabel,
      periodFrom: from,
      periodToInclusive,
      currency: boardCurrency,
      totalExpenses,
      expenseCount,
      availableCycles,
    };
  }

  async getConsolidatedReport(
    yearMonth: string,
    userId: string,
    boardIds?: string[],
  ): Promise<ConsolidatedReport> {
    const userBoards = (await this.boardsService.findAll(
      userId,
    )) as unknown as BoardListItem[];
    const allowedBoardIds = new Set(
      userBoards.map((board) => getBoardId(board)),
    );

    let targetBoardIds: string[];
    if (boardIds && boardIds.length > 0) {
      const uniqueBoardIds = [...new Set(boardIds)];
      const invalid = uniqueBoardIds.filter((id) => !allowedBoardIds.has(id));
      if (invalid.length > 0) {
        throw new ForbiddenBoardAccessError(invalid);
      }
      targetBoardIds = uniqueBoardIds;
    } else {
      targetBoardIds = Array.from(allowedBoardIds);
    }

    const targetSet = new Set(targetBoardIds);
    targetBoardIds = targetBoardIds.filter((id) => {
      const board = userBoards.find((item) => getBoardId(item) === id);
      if (board?.type !== BoardType.TRAVEL) return true;
      const linkedEverydayBoardId =
        board.linkedEverydayBoardId ?? board.parentBoardId?.toString();
      return !linkedEverydayBoardId || !targetSet.has(linkedEverydayBoardId);
    });

    const boards: ConsolidatedBoardSummary[] = [];
    const totalsByCurrency: Record<string, CurrencyTotals> = {};

    for (const boardId of targetBoardIds) {
      const boardMeta = userBoards.find(
        (board) => getBoardId(board) === boardId,
      );
      if (!boardMeta) {
        continue;
      }

      const summary = await this.getBoardCalendarReport(
        boardId,
        yearMonth,
        userId,
      );

      const boardSummary: ConsolidatedBoardSummary = {
        boardId,
        boardName: boardMeta.name,
        currency: summary.currency,
        totalIncomes: summary.totalIncomes,
        totalExpenses: summary.totalExpenses,
        remaining: summary.remaining,
      };
      boards.push(boardSummary);

      const currencyTotals = totalsByCurrency[summary.currency] ?? {
        totalIncomes: 0,
        totalExpenses: 0,
        remaining: 0,
        boardCount: 0,
      };
      currencyTotals.totalIncomes += summary.totalIncomes;
      currencyTotals.totalExpenses += summary.totalExpenses;
      currencyTotals.remaining += summary.remaining;
      currencyTotals.boardCount += 1;
      totalsByCurrency[summary.currency] = currencyTotals;
    }

    return {
      yearMonth,
      boards,
      totalsByCurrency,
    };
  }

  private async buildCategoryBreakdown(
    boardIds: Types.ObjectId[],
    expenses: Expense[],
    boardCurrency: string,
  ): Promise<CategoryBreakdownItem[]> {
    const totals = new Map<string | null, { total: number; count: number }>();

    for (const expense of expenses) {
      const amountInBoardCurrency = getExpenseAmountInBoardCurrency(
        expense,
        boardCurrency,
      );
      if (amountInBoardCurrency == null) {
        continue;
      }
      const key = expense.categoryId?.toString() ?? null;
      const current = totals.get(key) ?? { total: 0, count: 0 };
      current.total += amountInBoardCurrency;
      current.count += 1;
      totals.set(key, current);
    }

    const categoryIds = [...totals.keys()].filter(
      (id): id is string => id !== null,
    );
    const categories =
      categoryIds.length > 0
        ? await this.categoryModel
            .find({
              tripId: { $in: boardIds },
              _id: { $in: categoryIds.map((id) => new Types.ObjectId(id)) },
            })
            .lean()
        : [];

    const categoryNameById = new Map(
      categories.map((category) => [category._id.toString(), category.name]),
    );

    const items: CategoryBreakdownItem[] = [];
    for (const [categoryId, data] of totals.entries()) {
      items.push({
        categoryId,
        categoryName: categoryId
          ? (categoryNameById.get(categoryId) ?? 'Categoría eliminada')
          : 'Sin categoría',
        total: data.total,
        count: data.count,
      });
    }

    return items.sort((a, b) => b.total - a.total);
  }

  private async buildPaymentMethodBreakdown(
    expenses: Expense[],
    boardCurrency: string,
  ): Promise<PaymentMethodBreakdownItem[]> {
    const totals = new Map<string | null, { total: number; count: number }>();

    for (const expense of expenses) {
      const amountInBoardCurrency = getExpenseAmountInBoardCurrency(
        expense,
        boardCurrency,
      );
      if (amountInBoardCurrency == null) {
        continue;
      }
      const key = resolveExpensePaymentMethodId(expense);
      const current = totals.get(key) ?? { total: 0, count: 0 };
      current.total += amountInBoardCurrency;
      current.count += 1;
      totals.set(key, current);
    }

    const paymentMethodIds = [...totals.keys()].filter(
      (id): id is string => id !== null,
    );
    const paymentMethods =
      paymentMethodIds.length > 0
        ? await this.paymentMethodModel
            .find({
              _id: {
                $in: paymentMethodIds.map((id) => new Types.ObjectId(id)),
              },
            })
            .lean()
        : [];

    const methodById = new Map(
      paymentMethods.map((method) => [method._id.toString(), method]),
    );

    const items: PaymentMethodBreakdownItem[] = [];
    for (const [paymentMethodId, data] of totals.entries()) {
      const method = paymentMethodId
        ? methodById.get(paymentMethodId)
        : undefined;
      items.push({
        paymentMethodId,
        paymentMethodName: method?.name ?? 'Sin medio de pago',
        kind: method?.kind ?? null,
        total: data.total,
        count: data.count,
      });
    }

    return items.sort((a, b) => b.total - a.total);
  }
}

export class ForbiddenBoardAccessError extends BadRequestException {
  constructor(boardIds: string[]) {
    super(`No tienes acceso a los siguientes tableros: ${boardIds.join(', ')}`);
  }
}

// Exported for unit tests of cycle assignment on expenses
export { resolveCycleClosingMonth };
