import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  BoardMonthBudget,
  BoardMonthBudgetDocument,
} from './board-month-budget.schema';
import { Expense, ExpenseDocument } from '../expenses/expense.schema';
import { CreateBoardMonthBudgetDto } from './dto/create-board-month-budget.dto';
import { UpdateBoardMonthBudgetDto } from './dto/update-board-month-budget.dto';
import { ParticipantsService } from '../participants/participants.service';
import { BoardsService } from '../trips/trips.service';
import { CategoriesService } from '../categories/categories.service';
import { resolveBoardId } from '../common/utils/resolve-board-id';
import { parseYearMonth } from '../common/utils/parse-year-month';
import { DEFAULT_CURRENCY } from '../common/constants/currencies';

export interface BoardMonthBudgetProgress {
  budgetId: string;
  boardId: string;
  categoryId: string;
  yearMonth: string;
  limit: number;
  spent: number;
  remaining: number;
  percentUsed: number;
  currency: string;
}

type BoardMonthBudgetRecord = BoardMonthBudget & { _id: Types.ObjectId };

function parseDateFrom(value: string): Date {
  return new Date(value);
}

@Injectable()
export class BoardMonthBudgetsService {
  private readonly logger = new Logger(BoardMonthBudgetsService.name);

  constructor(
    @InjectModel(BoardMonthBudget.name)
    private boardMonthBudgetModel: Model<BoardMonthBudgetDocument>,
    @InjectModel(Expense.name)
    private expenseModel: Model<ExpenseDocument>,
    private participantsService: ParticipantsService,
    private boardsService: BoardsService,
    private categoriesService: CategoriesService,
  ) {}

  async create(
    createDto: CreateBoardMonthBudgetDto,
    userId: string,
  ): Promise<BoardMonthBudget> {
    const boardId = resolveBoardId(createDto);
    if (!boardId) {
      throw new BadRequestException('boardId o tripId es requerido');
    }

    await this.participantsService.ensureParticipantAccess(boardId, userId);
    const board = await this.boardsService.assertEverydayFeatures(boardId);

    const category = await this.categoriesService.findOne(
      createDto.categoryId,
      userId,
    );
    if (category.tripId.toString() !== boardId) {
      throw new BadRequestException('La categoría no pertenece a este tablero');
    }

    parseYearMonth(createDto.yearMonth);

    const existing = await this.boardMonthBudgetModel.findOne({
      tripId: new Types.ObjectId(boardId),
      categoryId: new Types.ObjectId(createDto.categoryId),
      yearMonth: createDto.yearMonth,
    });

    if (existing) {
      throw new BadRequestException(
        'Ya existe un presupuesto mensual para esta categoría en ese mes',
      );
    }

    const budget = new this.boardMonthBudgetModel({
      tripId: new Types.ObjectId(boardId),
      categoryId: new Types.ObjectId(createDto.categoryId),
      yearMonth: createDto.yearMonth,
      limit: createDto.limit,
      currency: createDto.currency ?? board.baseCurrency ?? DEFAULT_CURRENCY,
      createdBy: new Types.ObjectId(userId),
    });

    const saved = await budget.save();
    this.logger.log(
      `Board month budget created: ${saved._id.toString()} on board ${boardId}`,
    );
    return saved;
  }

  async findAllByBoardAndMonth(
    boardId: string,
    yearMonth: string,
    userId: string,
  ): Promise<BoardMonthBudgetProgress[]> {
    await this.participantsService.ensureParticipantAccess(boardId, userId);
    await this.boardsService.assertEverydayFeatures(boardId);

    parseYearMonth(yearMonth);

    const budgets = await this.boardMonthBudgetModel
      .find({
        tripId: new Types.ObjectId(boardId),
        yearMonth,
      })
      .sort({ createdAt: 1 })
      .lean();

    return this.attachProgress(boardId, yearMonth, budgets);
  }

  async getProgress(
    boardId: string,
    yearMonth: string,
    userId: string,
  ): Promise<BoardMonthBudgetProgress[]> {
    return this.findAllByBoardAndMonth(boardId, yearMonth, userId);
  }

  async findOne(id: string, userId: string): Promise<BoardMonthBudgetProgress> {
    const budget = await this.boardMonthBudgetModel.findById(id).lean();

    if (!budget) {
      throw new NotFoundException('Presupuesto mensual no encontrado');
    }

    const boardId = budget.tripId.toString();
    await this.participantsService.ensureParticipantAccess(boardId, userId);
    await this.boardsService.assertEverydayFeatures(boardId);

    const [progress] = await this.attachProgress(boardId, budget.yearMonth, [
      budget,
    ]);
    return progress;
  }

  async update(
    id: string,
    updateDto: UpdateBoardMonthBudgetDto,
    userId: string,
  ): Promise<BoardMonthBudget> {
    const budget = await this.boardMonthBudgetModel.findById(id);

    if (!budget) {
      throw new NotFoundException('Presupuesto mensual no encontrado');
    }

    const boardId = budget.tripId.toString();
    await this.participantsService.ensureParticipantAccess(boardId, userId);
    await this.boardsService.assertEverydayFeatures(boardId);

    if (updateDto.limit !== undefined) {
      budget.limit = updateDto.limit;
    }
    if (updateDto.currency !== undefined) {
      budget.currency = updateDto.currency;
    }

    budget.updatedAt = new Date();
    const saved = await budget.save();
    this.logger.log(`Board month budget updated: ${id}`);
    return saved;
  }

  async remove(id: string, userId: string): Promise<void> {
    const budget = await this.boardMonthBudgetModel.findById(id);

    if (!budget) {
      throw new NotFoundException('Presupuesto mensual no encontrado');
    }

    await this.participantsService.ensureParticipantAccess(
      budget.tripId.toString(),
      userId,
    );
    await this.boardsService.assertEverydayFeatures(budget.tripId.toString());

    await this.boardMonthBudgetModel.findByIdAndDelete(id);
    this.logger.log(`Board month budget deleted: ${id}`);
  }

  private async attachProgress(
    boardId: string,
    yearMonth: string,
    budgets: BoardMonthBudgetRecord[],
  ): Promise<BoardMonthBudgetProgress[]> {
    if (budgets.length === 0) {
      return [];
    }

    const board = await this.boardsService.findByIdOrFail(boardId);
    const boardCurrency = board.baseCurrency ?? DEFAULT_CURRENCY;
    const { from, toExclusive } = parseYearMonth(yearMonth);
    const dateFilter = {
      $gte: parseDateFrom(from),
      $lt: parseDateFrom(toExclusive),
    };

    const categoryIds = budgets.map((b) => b.categoryId);
    const expenses = await this.expenseModel
      .find({
        tripId: new Types.ObjectId(boardId),
        categoryId: { $in: categoryIds },
        expenseDate: dateFilter,
      })
      .lean();

    const spentByCategory = new Map<string, number>();
    for (const expense of expenses) {
      if (expense.currency !== boardCurrency) {
        continue;
      }
      const key = expense.categoryId?.toString();
      if (!key) {
        continue;
      }
      spentByCategory.set(
        key,
        (spentByCategory.get(key) ?? 0) + expense.amount,
      );
    }

    return budgets.map((budget) => {
      const categoryKey = budget.categoryId.toString();
      const spent = spentByCategory.get(categoryKey) ?? 0;
      const limit = budget.limit;
      const remaining = limit - spent;
      const percentUsed =
        limit > 0 ? Math.round((spent / limit) * 10000) / 100 : 0;

      return {
        budgetId: budget._id.toString(),
        boardId,
        categoryId: categoryKey,
        yearMonth: budget.yearMonth,
        limit,
        spent,
        remaining,
        percentUsed,
        currency: budget.currency,
      };
    });
  }
}
