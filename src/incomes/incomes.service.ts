import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Income, IncomeDocument, IncomeStatus } from './income.schema';
import {
  Expense,
  ExpenseDocument,
  ExpenseStatus,
} from '../expenses/expense.schema';
import { CreateIncomeDto } from './dto/create-income.dto';
import { UpdateIncomeDto } from './dto/update-income.dto';
import { ParticipantsService } from '../participants/participants.service';
import { BoardsService } from '../trips/trips.service';
import { resolveBoardId } from '../common/utils/resolve-board-id';
import {
  parseYearMonth,
  shiftYearMonth,
  yearMonthFromUtcDate,
} from '../common/utils/parse-year-month';
import { DEFAULT_CURRENCY } from '../common/constants/currencies';
import { getPersonalExpenseAmount } from '../common/utils/personal-expense-attribution';
import {
  CurrencyBreakdownBuilder,
  CurrencyBreakdownEntry,
} from '../common/utils/currency-breakdown';
import { BoardType } from '../trips/board.schema';
import { RecurringMaterializationService } from '../recurring-materialization/recurring-materialization.service';
import { PaymentMethodsService } from '../payment-methods/payment-methods.service';

export interface MonthlyBoardSummary {
  boardId: string;
  yearMonth: string;
  currency: string;
  totalIncomes: number;
  totalExpenses: number;
  remaining: number;
  /** Totals in other currencies are never converted — shown separately, not blended into the board currency. */
  incomesByCurrency: CurrencyBreakdownEntry[];
  expensesByCurrency: CurrencyBreakdownEntry[];
}

function parseIncomeDate(value: string): Date {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new BadRequestException('incomeDate no es una fecha válida');
  }
  return parsed;
}

function parseDateFrom(value: string): Date {
  return new Date(value);
}

@Injectable()
export class IncomesService {
  private readonly logger = new Logger(IncomesService.name);

  constructor(
    @InjectModel(Income.name)
    private incomeModel: Model<IncomeDocument>,
    @InjectModel(Expense.name)
    private expenseModel: Model<ExpenseDocument>,
    private participantsService: ParticipantsService,
    private boardsService: BoardsService,
    private materializationService: RecurringMaterializationService,
    private paymentMethodsService: PaymentMethodsService,
  ) {}

  async create(
    createIncomeDto: CreateIncomeDto,
    userId: string,
  ): Promise<Income> {
    const boardId = resolveBoardId(createIncomeDto);
    if (!boardId) {
      throw new BadRequestException('boardId o tripId es requerido');
    }

    await this.participantsService.ensureParticipantAccess(boardId, userId);
    const board = await this.boardsService.findByIdOrFail(boardId);
    const incomeDate = createIncomeDto.incomeDate
      ? parseIncomeDate(createIncomeDto.incomeDate)
      : new Date();
    const income = new this.incomeModel({
      tripId: new Types.ObjectId(boardId),
      amount: createIncomeDto.amount,
      currency:
        createIncomeDto.currency ?? board.baseCurrency ?? DEFAULT_CURRENCY,
      label: createIncomeDto.label.trim(),
      description: createIncomeDto.description?.trim(),
      incomeDate,
      status:
        incomeDate.getTime() > Date.now()
          ? IncomeStatus.PENDING
          : IncomeStatus.CONFIRMED,
      createdBy: new Types.ObjectId(userId),
    });

    const saved = await income.save();
    this.logger.log(
      `Income created: ${saved._id.toString()} on board ${boardId}`,
    );
    return saved;
  }

  async findAllByBoard(boardId: string, userId: string): Promise<Income[]> {
    await this.participantsService.ensureParticipantAccess(boardId, userId);

    return this.incomeModel
      .find({ tripId: new Types.ObjectId(boardId) })
      .sort({ incomeDate: -1, createdAt: -1 })
      .lean();
  }

  async findRecentByMonth(
    boardId: string,
    userId: string,
    yearMonth: string,
  ): Promise<Income[]> {
    const { from, toExclusive } = parseYearMonth(yearMonth);
    await this.participantsService.ensureParticipantAccess(boardId, userId);
    return this.incomeModel
      .find({
        tripId: new Types.ObjectId(boardId),
        incomeDate: { $gte: new Date(from), $lt: new Date(toExclusive) },
        $or: [{ status: IncomeStatus.CONFIRMED }, { status: null }],
      })
      .sort({ createdAt: -1, _id: -1 })
      .limit(5)
      .lean();
  }

  async findOne(id: string, userId: string): Promise<Income> {
    const income = await this.incomeModel.findById(id).lean();

    if (!income) {
      throw new NotFoundException('Ingreso no encontrado');
    }

    await this.participantsService.ensureParticipantAccess(
      income.tripId.toString(),
      userId,
    );

    return income;
  }

  async update(
    id: string,
    updateIncomeDto: UpdateIncomeDto,
    userId: string,
  ): Promise<Income> {
    const income = await this.incomeModel.findById(id);

    if (!income) {
      throw new NotFoundException('Ingreso no encontrado');
    }

    await this.participantsService.ensureParticipantAccess(
      income.tripId.toString(),
      userId,
    );

    if (updateIncomeDto.amount !== undefined) {
      income.amount = updateIncomeDto.amount;
    }
    if (updateIncomeDto.currency !== undefined) {
      income.currency = updateIncomeDto.currency;
    }
    if (updateIncomeDto.label !== undefined) {
      income.label = updateIncomeDto.label.trim();
    }
    if (updateIncomeDto.description !== undefined) {
      income.description = updateIncomeDto.description.trim();
    }
    if (updateIncomeDto.incomeDate !== undefined) {
      income.incomeDate = parseIncomeDate(updateIncomeDto.incomeDate);
    }

    const saved = await income.save();
    this.logger.log(`Income updated: ${id}`);
    return saved;
  }

  async remove(id: string, userId: string): Promise<void> {
    const income = await this.incomeModel.findById(id);

    if (!income) {
      throw new NotFoundException('Ingreso no encontrado');
    }

    await this.participantsService.ensureParticipantAccess(
      income.tripId.toString(),
      userId,
    );

    await this.incomeModel.findByIdAndDelete(id);
    this.logger.log(`Income deleted: ${id}`);
  }

  async confirm(id: string, userId: string): Promise<Income> {
    const income = await this.incomeModel.findById(id);

    if (!income) {
      throw new NotFoundException('Ingreso no encontrado');
    }

    await this.participantsService.ensureParticipantAccess(
      income.tripId.toString(),
      userId,
    );

    if (income.status === IncomeStatus.CONFIRMED) {
      throw new BadRequestException('Este ingreso ya está confirmado');
    }

    if (income.skippedAt) {
      throw new BadRequestException('No se puede confirmar un ingreso omitido');
    }

    income.status = IncomeStatus.CONFIRMED;
    const saved = await income.save();
    this.logger.log(`Income confirmed: ${id}`);
    return saved;
  }

  async skip(id: string, userId: string): Promise<void> {
    await this.materializationService.skipIncomeOccurrence(id, userId);
  }

  async getMonthlySummary(
    boardId: string,
    yearMonth: string,
    userId: string,
  ): Promise<MonthlyBoardSummary> {
    await this.participantsService.ensureParticipantAccess(boardId, userId);

    const board = await this.boardsService.findByIdOrFail(boardId);
    const expenseScope = await this.boardsService.findExpenseScopeContext(
      boardId,
      userId,
    );
    const boardCurrency = board.baseCurrency ?? DEFAULT_CURRENCY;
    const { from, toExclusive } = parseYearMonth(yearMonth);

    const dateFilter = {
      $gte: parseDateFrom(from),
      $lt: parseDateFrom(toExclusive),
    };

    const boardObjectId = new Types.ObjectId(boardId);
    const expenseBoardIds = expenseScope.map((item) => item.board._id);

    // Every expense carries its own explicit mes de pago now — no more
    // calendar-vs-cycle attribution branching needed.
    const expenseQuery = {
      tripId: { $in: expenseBoardIds },
      skippedAt: { $exists: false },
      paymentYearMonth: yearMonth,
      $or: [
        { recurringExpenseId: { $exists: false } },
        { status: ExpenseStatus.PAID },
      ],
    };

    const [incomes, expenses] = await Promise.all([
      this.incomeModel
        .find({
          tripId: boardObjectId,
          incomeDate: dateFilter,
          skippedAt: { $exists: false },
          $or: [
            { recurringIncomeId: { $exists: false } },
            { status: IncomeStatus.CONFIRMED },
          ],
        })
        .lean(),
      this.expenseModel.find(expenseQuery).lean(),
    ]);

    return this.summarizeMonthly(
      boardId,
      yearMonth,
      boardCurrency,
      board.type,
      expenseScope,
      incomes,
      expenses,
    );
  }

  async getMonthlySummaryRange(
    boardId: string,
    startYearMonth: string,
    monthsCount: number,
    userId: string,
  ): Promise<MonthlyBoardSummary[]> {
    await this.participantsService.ensureParticipantAccess(boardId, userId);
    const scope = await this.boardsService.findExpenseScopeContext(
      boardId,
      userId,
    );
    const board = scope[0].board;
    const months = Array.from({ length: monthsCount }, (_, index) =>
      shiftYearMonth(startYearMonth, index),
    );
    const from = new Date(parseYearMonth(startYearMonth).from);
    const to = new Date(parseYearMonth(months[months.length - 1]).toExclusive);
    const [incomes, expenses] = await Promise.all([
      this.incomeModel
        .find({
          tripId: new Types.ObjectId(boardId),
          incomeDate: { $gte: from, $lt: to },
          skippedAt: { $exists: false },
          $or: [
            { recurringIncomeId: { $exists: false } },
            { status: IncomeStatus.CONFIRMED },
          ],
        })
        .lean(),
      this.expenseModel
        .find({
          tripId: { $in: scope.map((item) => item.board._id) },
          paymentYearMonth: {
            $gte: startYearMonth,
            $lte: months[months.length - 1],
          },
          skippedAt: { $exists: false },
          $or: [
            { recurringExpenseId: { $exists: false } },
            { status: ExpenseStatus.PAID },
          ],
        })
        .lean(),
    ]);
    const incomesByMonth = new Map<string, Income[]>();
    const expensesByMonth = new Map<string, Expense[]>();
    for (const income of incomes) {
      const month = yearMonthFromUtcDate(new Date(income.incomeDate));
      const items = incomesByMonth.get(month) ?? [];
      items.push(income);
      incomesByMonth.set(month, items);
    }
    for (const expense of expenses) {
      const month = expense.paymentYearMonth!;
      const items = expensesByMonth.get(month) ?? [];
      items.push(expense);
      expensesByMonth.set(month, items);
    }
    return months.map((month) =>
      this.summarizeMonthly(
        boardId,
        month,
        board.baseCurrency ?? DEFAULT_CURRENCY,
        board.type,
        scope,
        incomesByMonth.get(month) ?? [],
        expensesByMonth.get(month) ?? [],
      ),
    );
  }

  private summarizeMonthly(
    boardId: string,
    yearMonth: string,
    boardCurrency: string,
    boardType: BoardType,
    expenseScope: Array<{
      board: { _id: Types.ObjectId; type: BoardType };
      participantId: Types.ObjectId;
    }>,
    incomes: Income[],
    expenses: Expense[],
  ): MonthlyBoardSummary {
    const incomeTotals = new CurrencyBreakdownBuilder();
    for (const income of incomes) {
      incomeTotals.add(income.currency, income.amount);
    }

    const expenseTotals = new CurrencyBreakdownBuilder();
    const participantByBoardId = new Map(
      expenseScope.map((item) => [
        item.board._id.toString(),
        item.participantId,
      ]),
    );
    const typeByBoardId = new Map(
      expenseScope.map((item) => [item.board._id.toString(), item.board.type]),
    );
    for (const sourceExpense of expenses) {
      const sourceBoardId = sourceExpense.tripId?.toString() ?? boardId;
      const inheritedTravel =
        boardType === BoardType.EVERYDAY &&
        typeByBoardId.get(sourceBoardId) === BoardType.TRAVEL;
      const attributedAmount = inheritedTravel
        ? getPersonalExpenseAmount(
            sourceExpense,
            participantByBoardId.get(sourceBoardId)!,
          )
        : sourceExpense.amount;
      // 0 means "not this participant's share" (getPersonalExpenseAmount's
      // not-involved sentinel) — genuinely negative amounts are refunds and
      // must still be netted into the total, not dropped.
      if (attributedAmount === 0) continue;
      expenseTotals.add(sourceExpense.currency, attributedAmount);
    }

    const totalIncomes = incomeTotals.totalFor(boardCurrency);
    const totalExpenses = expenseTotals.totalFor(boardCurrency);

    return {
      boardId,
      yearMonth,
      currency: boardCurrency,
      totalIncomes,
      totalExpenses,
      remaining: totalIncomes - totalExpenses,
      incomesByCurrency: incomeTotals.otherThan(boardCurrency),
      expensesByCurrency: expenseTotals.otherThan(boardCurrency),
    };
  }
}
