import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  RecurringIncome,
  RecurringIncomeDocument,
} from './recurring-income.schema';
import {
  RecurringIncomeVersion,
  RecurringIncomeVersionDocument,
} from './recurring-income-version.schema';
import { CreateRecurringIncomeDto } from './dto/create-recurring-income.dto';
import { UpdateRecurringIncomeDto } from './dto/update-recurring-income.dto';
import { ParticipantsService } from '../participants/participants.service';
import { BoardsService } from '../trips/trips.service';
import { resolveBoardId } from '../common/utils/resolve-board-id';
import { normalizeDaysOfMonth } from '../common/utils/validate-day-of-month';
import { DEFAULT_CURRENCY } from '../common/constants/currencies';
import { RecurringMaterializationService } from '../recurring-materialization/recurring-materialization.service';
import { getCurrentYearMonth } from '../common/utils/parse-year-month';

@Injectable()
export class RecurringIncomesService {
  private readonly logger = new Logger(RecurringIncomesService.name);

  constructor(
    @InjectModel(RecurringIncome.name)
    private recurringIncomeModel: Model<RecurringIncomeDocument>,
    @InjectModel(RecurringIncomeVersion.name)
    private recurringIncomeVersionModel: Model<RecurringIncomeVersionDocument>,
    private participantsService: ParticipantsService,
    private boardsService: BoardsService,
    private materializationService: RecurringMaterializationService,
  ) {}

  async create(
    createDto: CreateRecurringIncomeDto,
    userId: string,
  ): Promise<RecurringIncome> {
    const boardId = resolveBoardId(createDto);
    if (!boardId) {
      throw new NotFoundException('boardId o tripId es requerido');
    }

    await this.participantsService.ensureParticipantAccess(boardId, userId);
    const board = await this.boardsService.findByIdOrFail(boardId);

    const recurringIncome = new this.recurringIncomeModel({
      tripId: new Types.ObjectId(boardId),
      amount: createDto.amount,
      currency: createDto.currency ?? board.baseCurrency ?? DEFAULT_CURRENCY,
      label: createDto.label.trim(),
      description: createDto.description?.trim(),
      daysOfMonth: normalizeDaysOfMonth(createDto.daysOfMonth),
      createdBy: new Types.ObjectId(userId),
    });

    const saved = await recurringIncome.save();

    await this.recurringIncomeVersionModel.create({
      recurringIncomeId: saved._id,
      amount: createDto.amount,
      effectiveFrom: getCurrentYearMonth(),
      createdBy: new Types.ObjectId(userId),
    });

    await this.materializationService.ensureHorizon(boardId, userId);

    this.logger.log(
      `Recurring income created: ${saved._id.toString()} on board ${boardId}`,
    );
    return saved;
  }

  async findAllByBoard(
    boardId: string,
    userId: string,
  ): Promise<RecurringIncome[]> {
    await this.participantsService.ensureParticipantAccess(boardId, userId);

    return this.recurringIncomeModel
      .find({ tripId: new Types.ObjectId(boardId) })
      .sort({ label: 1, createdAt: -1 })
      .lean();
  }

  async findActiveByBoard(
    boardId: string,
    userId: string,
  ): Promise<RecurringIncome[]> {
    await this.participantsService.ensureParticipantAccess(boardId, userId);

    return this.recurringIncomeModel
      .find({ tripId: new Types.ObjectId(boardId), isActive: true })
      .lean();
  }

  async findOne(id: string, userId: string): Promise<RecurringIncome> {
    const item = await this.recurringIncomeModel.findById(id).lean();
    if (!item) {
      throw new NotFoundException('Ingreso recurrente no encontrado');
    }

    await this.participantsService.ensureParticipantAccess(
      item.tripId.toString(),
      userId,
    );

    return item;
  }

  async update(
    id: string,
    updateDto: UpdateRecurringIncomeDto,
    userId: string,
  ): Promise<RecurringIncome> {
    const item = await this.recurringIncomeModel.findById(id);
    if (!item) {
      throw new NotFoundException('Ingreso recurrente no encontrado');
    }

    const boardId = item.tripId.toString();
    await this.participantsService.ensureParticipantAccess(boardId, userId);

    if (updateDto.cancelFromYearMonth) {
      await this.materializationService.cancelIncomeFromMonth(
        id,
        updateDto.cancelFromYearMonth,
        userId,
      );
    }

    if (updateDto.amount !== undefined) {
      const scope = updateDto.amountChangeScope ?? 'from_month';
      const yearMonth =
        updateDto.amountChangeYearMonth ?? getCurrentYearMonth();

      await this.materializationService.applyIncomeAmountChange(
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
    if (updateDto.daysOfMonth !== undefined) {
      item.daysOfMonth = normalizeDaysOfMonth(updateDto.daysOfMonth);
    }
    if (updateDto.isActive !== undefined) item.isActive = updateDto.isActive;

    const saved = await item.save();

    await this.materializationService.ensureHorizon(boardId, userId);

    this.logger.log(`Recurring income updated: ${id}`);
    return saved;
  }

  async remove(id: string, userId: string): Promise<void> {
    const item = await this.recurringIncomeModel.findById(id);
    if (!item) {
      throw new NotFoundException('Ingreso recurrente no encontrado');
    }

    await this.participantsService.ensureParticipantAccess(
      item.tripId.toString(),
      userId,
    );

    await this.materializationService.deleteRuleOccurrences(id, null);
    await this.recurringIncomeModel.findByIdAndDelete(id);
    this.logger.log(`Recurring income deleted: ${id}`);
  }
}
