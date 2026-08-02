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
import { parseYearMonth } from '../common/utils/parse-year-month';
import { DEFAULT_CURRENCY } from '../common/constants/currencies';
import { getExpenseAmountInBoardCurrency } from '../common/utils/expense-board-currency';
import { RecurringMaterializationService } from '../recurring-materialization/recurring-materialization.service';

export interface MonthlyBoardSummary {
  boardId: string;
  yearMonth: string;
  currency: string;
  totalIncomes: number;
  totalExpenses: number;
  remaining: number;
  /**
   * Incomes in other currencies are still excluded until income FX is added.
   * Expenses use FX snapshot when available (issue #9).
   */
  excludedDueToCurrencyMismatch: {
    incomes: number;
    expenses: number;
  };
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

    const income = new this.incomeModel({
      tripId: new Types.ObjectId(boardId),
      amount: createIncomeDto.amount,
      currency:
        createIncomeDto.currency ?? board.baseCurrency ?? DEFAULT_CURRENCY,
      label: createIncomeDto.label.trim(),
      description: createIncomeDto.description?.trim(),
      incomeDate: createIncomeDto.incomeDate
        ? parseIncomeDate(createIncomeDto.incomeDate)
        : new Date(),
      status: IncomeStatus.CONFIRMED,
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
    const boardCurrency = board.baseCurrency ?? DEFAULT_CURRENCY;
    const { from, toExclusive } = parseYearMonth(yearMonth);

    const dateFilter = {
      $gte: parseDateFrom(from),
      $lt: parseDateFrom(toExclusive),
    };

    const boardObjectId = new Types.ObjectId(boardId);

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
      this.expenseModel
        .find({
          tripId: boardObjectId,
          expenseDate: dateFilter,
          skippedAt: { $exists: false },
          $or: [
            { recurringExpenseId: { $exists: false } },
            { status: ExpenseStatus.PAID },
          ],
        })
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
    for (const expense of expenses) {
      const amountInBoardCurrency = getExpenseAmountInBoardCurrency(
        expense,
        boardCurrency,
      );
      if (amountInBoardCurrency == null) {
        excludedExpenses += 1;
        continue;
      }
      totalExpenses += amountInBoardCurrency;
    }

    return {
      boardId,
      yearMonth,
      currency: boardCurrency,
      totalIncomes,
      totalExpenses,
      remaining: totalIncomes - totalExpenses,
      excludedDueToCurrencyMismatch: {
        incomes: excludedIncomes,
        expenses: excludedExpenses,
      },
    };
  }
}
