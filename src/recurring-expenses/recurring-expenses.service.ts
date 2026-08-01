import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  RecurringExpense,
  RecurringExpenseDocument,
} from './recurring-expense.schema';
import { CreateRecurringExpenseDto } from './dto/create-recurring-expense.dto';
import { UpdateRecurringExpenseDto } from './dto/update-recurring-expense.dto';
import { ParticipantsService } from '../participants/participants.service';
import { BoardsService } from '../trips/trips.service';
import { resolveBoardId } from '../common/utils/resolve-board-id';
import { assertValidDayOfMonth } from '../common/utils/validate-day-of-month';
import { DEFAULT_CURRENCY } from '../common/constants/currencies';

@Injectable()
export class RecurringExpensesService {
  private readonly logger = new Logger(RecurringExpensesService.name);

  constructor(
    @InjectModel(RecurringExpense.name)
    private recurringExpenseModel: Model<RecurringExpenseDocument>,
    private participantsService: ParticipantsService,
    private boardsService: BoardsService,
  ) {}

  async create(
    createDto: CreateRecurringExpenseDto,
    userId: string,
  ): Promise<RecurringExpense> {
    const boardId = resolveBoardId(createDto);
    if (!boardId) {
      throw new BadRequestException('boardId o tripId es requerido');
    }

    assertValidDayOfMonth(createDto.dayOfMonth);

    await this.participantsService.ensureParticipantAccess(boardId, userId);
    const board = await this.boardsService.findByIdOrFail(boardId);

    const recurringExpense = new this.recurringExpenseModel({
      tripId: new Types.ObjectId(boardId),
      amount: createDto.amount,
      currency: createDto.currency ?? board.baseCurrency ?? DEFAULT_CURRENCY,
      label: createDto.label.trim(),
      description: createDto.description?.trim(),
      dayOfMonth: createDto.dayOfMonth,
      categoryId: createDto.categoryId
        ? new Types.ObjectId(createDto.categoryId)
        : undefined,
      paymentMethodId: createDto.paymentMethodId
        ? new Types.ObjectId(createDto.paymentMethodId)
        : undefined,
      createdBy: new Types.ObjectId(userId),
    });

    const saved = await recurringExpense.save();
    this.logger.log(
      `Recurring expense created: ${saved._id.toString()} on board ${boardId}`,
    );
    return saved;
  }

  async findAllByBoard(
    boardId: string,
    userId: string,
  ): Promise<RecurringExpense[]> {
    await this.participantsService.ensureParticipantAccess(boardId, userId);

    return this.recurringExpenseModel
      .find({ tripId: new Types.ObjectId(boardId) })
      .sort({ dayOfMonth: 1, label: 1 })
      .lean();
  }

  async findActiveByBoard(
    boardId: string,
    userId: string,
  ): Promise<RecurringExpense[]> {
    await this.participantsService.ensureParticipantAccess(boardId, userId);

    return this.recurringExpenseModel
      .find({ tripId: new Types.ObjectId(boardId), isActive: true })
      .lean();
  }

  async findOne(id: string, userId: string): Promise<RecurringExpense> {
    const item = await this.recurringExpenseModel.findById(id).lean();
    if (!item) {
      throw new NotFoundException('Gasto fijo no encontrado');
    }

    await this.participantsService.ensureParticipantAccess(
      item.tripId.toString(),
      userId,
    );

    return item;
  }

  async update(
    id: string,
    updateDto: UpdateRecurringExpenseDto,
    userId: string,
  ): Promise<RecurringExpense> {
    const item = await this.recurringExpenseModel.findById(id);
    if (!item) {
      throw new NotFoundException('Gasto fijo no encontrado');
    }

    await this.participantsService.ensureParticipantAccess(
      item.tripId.toString(),
      userId,
    );

    if (updateDto.amount !== undefined) item.amount = updateDto.amount;
    if (updateDto.currency !== undefined) item.currency = updateDto.currency;
    if (updateDto.label !== undefined) item.label = updateDto.label.trim();
    if (updateDto.description !== undefined) {
      item.description = updateDto.description.trim();
    }
    if (updateDto.dayOfMonth !== undefined) {
      assertValidDayOfMonth(updateDto.dayOfMonth);
      item.dayOfMonth = updateDto.dayOfMonth;
    }
    if (updateDto.categoryId !== undefined) {
      item.categoryId = updateDto.categoryId
        ? new Types.ObjectId(updateDto.categoryId)
        : undefined;
    }
    if (updateDto.paymentMethodId !== undefined) {
      item.paymentMethodId = updateDto.paymentMethodId
        ? new Types.ObjectId(updateDto.paymentMethodId)
        : undefined;
    }
    if (updateDto.isActive !== undefined) item.isActive = updateDto.isActive;

    const saved = await item.save();
    this.logger.log(`Recurring expense updated: ${id}`);
    return saved;
  }

  async remove(id: string, userId: string): Promise<void> {
    const item = await this.recurringExpenseModel.findById(id);
    if (!item) {
      throw new NotFoundException('Gasto fijo no encontrado');
    }

    await this.participantsService.ensureParticipantAccess(
      item.tripId.toString(),
      userId,
    );

    await this.recurringExpenseModel.findByIdAndDelete(id);
    this.logger.log(`Recurring expense deleted: ${id}`);
  }
}
