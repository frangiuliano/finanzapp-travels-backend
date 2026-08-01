import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  InstallmentPlan,
  InstallmentPlanDocument,
} from './installment-plan.schema';
import { CreateInstallmentPlanDto } from './dto/create-installment-plan.dto';
import { UpdateInstallmentPlanDto } from './dto/update-installment-plan.dto';
import { ParticipantsService } from '../participants/participants.service';
import { BoardsService } from '../trips/trips.service';
import { resolveBoardId } from '../common/utils/resolve-board-id';
import { assertValidDayOfMonth } from '../common/utils/validate-day-of-month';
import { parseYearMonth } from '../common/utils/parse-year-month';
import { DEFAULT_CURRENCY } from '../common/constants/currencies';

@Injectable()
export class InstallmentPlansService {
  private readonly logger = new Logger(InstallmentPlansService.name);

  constructor(
    @InjectModel(InstallmentPlan.name)
    private installmentPlanModel: Model<InstallmentPlanDocument>,
    private participantsService: ParticipantsService,
    private boardsService: BoardsService,
  ) {}

  async create(
    createDto: CreateInstallmentPlanDto,
    userId: string,
  ): Promise<InstallmentPlan> {
    const boardId = resolveBoardId(createDto);
    if (!boardId) {
      throw new BadRequestException('boardId o tripId es requerido');
    }

    assertValidDayOfMonth(createDto.dayOfMonth);
    parseYearMonth(createDto.startYearMonth);

    if ((createDto.paidInstallments ?? 0) > createDto.totalInstallments) {
      throw new BadRequestException(
        'paidInstallments no puede superar totalInstallments',
      );
    }

    await this.participantsService.ensureParticipantAccess(boardId, userId);
    const board = await this.boardsService.findByIdOrFail(boardId);

    const plan = new this.installmentPlanModel({
      tripId: new Types.ObjectId(boardId),
      label: createDto.label.trim(),
      installmentAmount: createDto.installmentAmount,
      totalInstallments: createDto.totalInstallments,
      paidInstallments: createDto.paidInstallments ?? 0,
      startYearMonth: createDto.startYearMonth,
      dayOfMonth: createDto.dayOfMonth,
      paymentMethodId: createDto.paymentMethodId
        ? new Types.ObjectId(createDto.paymentMethodId)
        : undefined,
      currency: createDto.currency ?? board.baseCurrency ?? DEFAULT_CURRENCY,
      createdBy: new Types.ObjectId(userId),
    });

    const saved = await plan.save();
    this.logger.log(
      `Installment plan created: ${saved._id.toString()} on board ${boardId}`,
    );
    return saved;
  }

  async findAllByBoard(
    boardId: string,
    userId: string,
  ): Promise<InstallmentPlan[]> {
    await this.participantsService.ensureParticipantAccess(boardId, userId);

    return this.installmentPlanModel
      .find({ tripId: new Types.ObjectId(boardId) })
      .sort({ startYearMonth: 1, label: 1 })
      .lean();
  }

  async findActiveByBoard(
    boardId: string,
    userId: string,
  ): Promise<InstallmentPlan[]> {
    await this.participantsService.ensureParticipantAccess(boardId, userId);

    return this.installmentPlanModel
      .find({ tripId: new Types.ObjectId(boardId), isActive: true })
      .lean();
  }

  async findOne(id: string, userId: string): Promise<InstallmentPlan> {
    const item = await this.installmentPlanModel.findById(id).lean();
    if (!item) {
      throw new NotFoundException('Plan de cuotas no encontrado');
    }

    await this.participantsService.ensureParticipantAccess(
      item.tripId.toString(),
      userId,
    );

    return item;
  }

  async update(
    id: string,
    updateDto: UpdateInstallmentPlanDto,
    userId: string,
  ): Promise<InstallmentPlan> {
    const item = await this.installmentPlanModel.findById(id);
    if (!item) {
      throw new NotFoundException('Plan de cuotas no encontrado');
    }

    await this.participantsService.ensureParticipantAccess(
      item.tripId.toString(),
      userId,
    );

    if (updateDto.label !== undefined) item.label = updateDto.label.trim();
    if (updateDto.installmentAmount !== undefined) {
      item.installmentAmount = updateDto.installmentAmount;
    }
    if (updateDto.totalInstallments !== undefined) {
      item.totalInstallments = updateDto.totalInstallments;
    }
    if (updateDto.paidInstallments !== undefined) {
      item.paidInstallments = updateDto.paidInstallments;
    }
    if (updateDto.startYearMonth !== undefined) {
      parseYearMonth(updateDto.startYearMonth);
      item.startYearMonth = updateDto.startYearMonth;
    }
    if (updateDto.dayOfMonth !== undefined) {
      assertValidDayOfMonth(updateDto.dayOfMonth);
      item.dayOfMonth = updateDto.dayOfMonth;
    }
    if (updateDto.paymentMethodId !== undefined) {
      item.paymentMethodId = updateDto.paymentMethodId
        ? new Types.ObjectId(updateDto.paymentMethodId)
        : undefined;
    }
    if (updateDto.currency !== undefined) item.currency = updateDto.currency;
    if (updateDto.isActive !== undefined) item.isActive = updateDto.isActive;

    if (item.paidInstallments > item.totalInstallments) {
      throw new BadRequestException(
        'paidInstallments no puede superar totalInstallments',
      );
    }

    const saved = await item.save();
    this.logger.log(`Installment plan updated: ${id}`);
    return saved;
  }

  async remove(id: string, userId: string): Promise<void> {
    const item = await this.installmentPlanModel.findById(id);
    if (!item) {
      throw new NotFoundException('Plan de cuotas no encontrado');
    }

    await this.participantsService.ensureParticipantAccess(
      item.tripId.toString(),
      userId,
    );

    await this.installmentPlanModel.findByIdAndDelete(id);
    this.logger.log(`Installment plan deleted: ${id}`);
  }
}
