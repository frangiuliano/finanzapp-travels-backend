import { Injectable, BadRequestException } from '@nestjs/common';
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
import { Board, BoardType } from '../trips/board.schema';
import { parseYearMonth } from '../common/utils/parse-year-month';
import { DEFAULT_CURRENCY } from '../common/constants/currencies';
import { getPersonalExpenseAmount } from '../common/utils/personal-expense-attribution';
import {
  CurrencyBreakdownBuilder,
  CurrencyBreakdownEntry,
} from '../common/utils/currency-breakdown';

export interface CategoryBreakdownItem {
  categoryId: string | null;
  categoryName: string;
  total: number;
  count: number;
  /** Totals in other currencies are never converted into `total` — shown alongside it instead. */
  otherCurrencyTotals: CurrencyBreakdownEntry[];
}

export interface PaymentMethodBreakdownItem {
  paymentMethodId: string | null;
  paymentMethodName: string;
  kind: PaymentMethodKind | null;
  total: number;
  count: number;
  /** Totals in other currencies are never converted into `total` — shown alongside it instead. */
  otherCurrencyTotals: CurrencyBreakdownEntry[];
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
  /** Totals in other currencies are never converted — shown separately, not blended into the board currency. */
  incomesByCurrency: CurrencyBreakdownEntry[];
  expensesByCurrency: CurrencyBreakdownEntry[];
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
        .find({ tripId: { $in: boardObjectIds }, paymentYearMonth: yearMonth })
        .lean(),
    ]);

    const incomeTotals = new CurrencyBreakdownBuilder();
    for (const income of incomes) {
      incomeTotals.add(income.currency, income.amount);
    }

    const expenseTotals = new CurrencyBreakdownBuilder();
    const attributedExpenses: Expense[] = [];

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
      expenseTotals.add(expense.currency, attributedAmount);
      attributedExpenses.push(expense);
    }

    const totalIncomes = incomeTotals.totalFor(boardCurrency);
    const totalExpenses = expenseTotals.totalFor(boardCurrency);

    const [byCategory, byPaymentMethod] = await Promise.all([
      this.buildCategoryBreakdown(
        boardObjectIds,
        attributedExpenses,
        boardCurrency,
      ),
      this.buildPaymentMethodBreakdown(attributedExpenses, boardCurrency),
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
      incomesByCurrency: incomeTotals.otherThan(boardCurrency),
      expensesByCurrency: expenseTotals.otherThan(boardCurrency),
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
    const totals = new Map<string | null, CurrencyBreakdownBuilder>();

    for (const expense of expenses) {
      const key = expense.categoryId?.toString() ?? null;
      const builder = totals.get(key) ?? new CurrencyBreakdownBuilder();
      builder.add(expense.currency, expense.amount);
      totals.set(key, builder);
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
    for (const [categoryId, builder] of totals.entries()) {
      items.push({
        categoryId,
        categoryName: categoryId
          ? (categoryNameById.get(categoryId) ?? 'Categoría eliminada')
          : 'Sin categoría',
        total: builder.totalFor(boardCurrency),
        count: builder.totalCount(),
        otherCurrencyTotals: builder.otherThan(boardCurrency),
      });
    }

    return items.sort((a, b) => b.total - a.total);
  }

  private async buildPaymentMethodBreakdown(
    expenses: Expense[],
    boardCurrency: string,
  ): Promise<PaymentMethodBreakdownItem[]> {
    const totals = new Map<string | null, CurrencyBreakdownBuilder>();

    for (const expense of expenses) {
      const key = resolveExpensePaymentMethodId(expense);
      const builder = totals.get(key) ?? new CurrencyBreakdownBuilder();
      builder.add(expense.currency, expense.amount);
      totals.set(key, builder);
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
    for (const [paymentMethodId, builder] of totals.entries()) {
      const method = paymentMethodId
        ? methodById.get(paymentMethodId)
        : undefined;
      items.push({
        paymentMethodId,
        paymentMethodName: method?.name ?? 'Sin medio de pago',
        kind: method?.kind ?? null,
        total: builder.totalFor(boardCurrency),
        count: builder.totalCount(),
        otherCurrencyTotals: builder.otherThan(boardCurrency),
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
