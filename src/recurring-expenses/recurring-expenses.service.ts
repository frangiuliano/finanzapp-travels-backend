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
import {
  RecurringExpenseVersion,
  RecurringExpenseVersionDocument,
} from './recurring-expense-version.schema';
import { CreateRecurringExpenseDto } from './dto/create-recurring-expense.dto';
import { UpdateRecurringExpenseDto } from './dto/update-recurring-expense.dto';
import { ParticipantsService } from '../participants/participants.service';
import { BoardsService } from '../trips/trips.service';
import { resolveBoardId } from '../common/utils/resolve-board-id';
import { assertValidDayOfMonth } from '../common/utils/validate-day-of-month';
import { DEFAULT_CURRENCY } from '../common/constants/currencies';
import { RecurringMaterializationService } from '../recurring-materialization/recurring-materialization.service';
import { getCurrentYearMonth } from '../common/utils/parse-year-month';

@Injectable()
export class RecurringExpensesService {
  private readonly logger = new Logger(RecurringExpensesService.name);

  constructor(
    @InjectModel(RecurringExpense.name)
    private recurringExpenseModel: Model<RecurringExpenseDocument>,
    @InjectModel(RecurringExpenseVersion.name)
    private recurringExpenseVersionModel: Model<RecurringExpenseVersionDocument>,
    private participantsService: ParticipantsService,
    private boardsService: BoardsService,
    private materializationService: RecurringMaterializationService,
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
    this.assertValidEscalation(
      createDto.escalationType,
      createDto.escalationValue,
      createDto.escalationFrequencyMonths,
    );

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
      escalationType: createDto.escalationType,
      escalationValue: createDto.escalationValue,
      escalationFrequencyMonths: createDto.escalationFrequencyMonths,
      excludedYearMonths: createDto.excludedYearMonths ?? [],
      createdBy: new Types.ObjectId(userId),
    });

    const saved = await recurringExpense.save();

    await this.recurringExpenseVersionModel.create({
      recurringExpenseId: saved._id,
      amount: createDto.amount,
      effectiveFrom: createDto.anchorYearMonth ?? getCurrentYearMonth(),
      createdBy: new Types.ObjectId(userId),
    });

    await this.materializationService.ensureHorizon(boardId, userId);

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

    const boardId = item.tripId.toString();
    await this.participantsService.ensureParticipantAccess(boardId, userId);

    if (updateDto.cancelFromYearMonth) {
      await this.materializationService.cancelExpenseFromMonth(
        id,
        updateDto.cancelFromYearMonth,
        userId,
      );
    }

    if (updateDto.amount !== undefined) {
      const scope = updateDto.amountChangeScope ?? 'from_month';
      const yearMonth =
        updateDto.amountChangeYearMonth ?? getCurrentYearMonth();

      await this.materializationService.applyExpenseAmountChange(
        id,
        updateDto.amount,
        scope,
        yearMonth,
        userId,
      );
    }

    if (updateDto.currency !== undefined) item.currency = updateDto.currency;
    if (updateDto.label !== undefined) item.label = updateDto.label.trim();
    if (updateDto.description !== undefined) {
      item.description = updateDto.description.trim();
    }
    let dayOfMonthChanged = false;
    if (updateDto.dayOfMonth !== undefined) {
      assertValidDayOfMonth(updateDto.dayOfMonth);
      dayOfMonthChanged = updateDto.dayOfMonth !== item.dayOfMonth;
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

    let newlyExcludedYearMonths: string[] = [];
    if (updateDto.excludedYearMonths !== undefined) {
      const previouslyExcluded = new Set(item.excludedYearMonths ?? []);
      newlyExcludedYearMonths = updateDto.excludedYearMonths.filter(
        (yearMonth) => !previouslyExcluded.has(yearMonth),
      );
      item.excludedYearMonths = updateDto.excludedYearMonths;
    }

    let escalationChanged = false;
    if (updateDto.disableEscalation) {
      escalationChanged =
        item.escalationType !== undefined ||
        item.escalationValue !== undefined ||
        item.escalationFrequencyMonths !== undefined;
      item.escalationType = undefined;
      item.escalationValue = undefined;
      item.escalationFrequencyMonths = undefined;
    } else if (
      updateDto.escalationType !== undefined ||
      updateDto.escalationValue !== undefined ||
      updateDto.escalationFrequencyMonths !== undefined
    ) {
      const nextType = updateDto.escalationType ?? item.escalationType;
      const nextValue = updateDto.escalationValue ?? item.escalationValue;
      const nextFrequency =
        updateDto.escalationFrequencyMonths ?? item.escalationFrequencyMonths;

      this.assertValidEscalation(nextType, nextValue, nextFrequency);

      escalationChanged =
        item.escalationType !== nextType ||
        item.escalationValue !== nextValue ||
        item.escalationFrequencyMonths !== nextFrequency;

      item.escalationType = nextType;
      item.escalationValue = nextValue;
      item.escalationFrequencyMonths = nextFrequency;
    }

    const saved = await item.save();

    if (dayOfMonthChanged) {
      await this.materializationService.removePendingExpensesForDayChange(id);
    }

    await this.materializationService.ensureHorizon(boardId, userId);

    if (newlyExcludedYearMonths.length > 0) {
      await this.materializationService.removePendingExpensesForExcludedMonths(
        id,
        newlyExcludedYearMonths,
      );
    }

    if (escalationChanged) {
      await this.materializationService.syncPendingExpenseAmountsFromMonth(
        id,
        getCurrentYearMonth(),
      );
    }

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

    await this.materializationService.deleteRuleOccurrences(null, id);
    await this.recurringExpenseModel.findByIdAndDelete(id);
    this.logger.log(`Recurring expense deleted: ${id}`);
  }

  private assertValidEscalation(
    type?: 'percent' | 'fixed',
    value?: number,
    frequencyMonths?: number,
  ): void {
    const anyFieldSet =
      type !== undefined ||
      value !== undefined ||
      frequencyMonths !== undefined;
    if (!anyFieldSet) return;

    if (
      type === undefined ||
      value === undefined ||
      frequencyMonths === undefined
    ) {
      throw new BadRequestException(
        'Para configurar el aumento hace falta el tipo, el valor y cada cuántos meses se aplica',
      );
    }

    if (type === 'percent' && value > 1000) {
      throw new BadRequestException(
        'El porcentaje de aumento debe ser menor o igual a 1000',
      );
    }
  }
}
