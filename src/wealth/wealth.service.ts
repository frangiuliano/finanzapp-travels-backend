import {
  BadRequestException,
  Injectable,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  AdjustHoldingBalanceDto,
  CreateGoalContributionDto,
  CreateHoldingDto,
  CreateSavingsGoalDto,
  UpdateHoldingDto,
  UpdateSavingsGoalDto,
  CreateInstrumentDto,
  CreateInvestmentTransactionDto,
  CreatePositionDto,
  UpdatePositionPriceDto,
} from './wealth.dto';
import {
  GoalAllocation,
  GoalAllocationDocument,
  Holding,
  HoldingDocument,
  HoldingType,
  SavingsGoal,
  SavingsGoalDocument,
  SavingsGoalStatus,
  WealthEvent,
  WealthEventDocument,
  WealthEventKind,
  FinancialInstrument,
  FinancialInstrumentDocument,
  InvestmentPosition,
  InvestmentPositionDocument,
  InvestmentTransaction,
  InvestmentTransactionDocument,
  InvestmentTransactionType,
} from './wealth.schemas';
import { DEFAULT_INSTRUMENTS } from './default-instruments';
import { ParticipantsService } from '../participants/participants.service';
import { Board, BoardDocument } from '../trips/board.schema';
import { User, UserDocument } from '../users/user.schema';

type GoalWithProgress = Record<string, unknown> & {
  allocatedAmount: number;
  remainingAmount: number;
  progressPercent: number;
  requiredMonthlyContribution: number | null;
  actualMonthlyContribution: number;
  estimatedCompletionDate: string | null;
  paceStatus: 'on_track' | 'behind' | 'no_plan' | 'completed';
  allocations: unknown[];
};

@Injectable()
export class WealthService implements OnModuleInit {
  constructor(
    @InjectModel(Holding.name) private holdingModel: Model<HoldingDocument>,
    @InjectModel(SavingsGoal.name)
    private goalModel: Model<SavingsGoalDocument>,
    @InjectModel(GoalAllocation.name)
    private allocationModel: Model<GoalAllocationDocument>,
    @InjectModel(WealthEvent.name)
    private eventModel: Model<WealthEventDocument>,
    @InjectModel(FinancialInstrument.name)
    private instrumentModel: Model<FinancialInstrumentDocument>,
    @InjectModel(InvestmentPosition.name)
    private positionModel: Model<InvestmentPositionDocument>,
    @InjectModel(InvestmentTransaction.name)
    private transactionModel: Model<InvestmentTransactionDocument>,
    @InjectModel(Board.name) private boardModel: Model<BoardDocument>,
    @InjectModel(User.name) private userModel: Model<UserDocument>,
    private participantsService: ParticipantsService,
  ) {}

  async onModuleInit() {
    await Promise.all(
      DEFAULT_INSTRUMENTS.map(([symbol, name, type, currency, exchange]) =>
        this.instrumentModel.updateOne(
          { symbol, exchange },
          {
            $setOnInsert: {
              symbol,
              name,
              type,
              currency,
              exchange,
              isSystem: true,
              isActive: true,
            },
          },
          { upsert: true },
        ),
      ),
    );
  }

  async getOverview(userId: string, boardId: string) {
    await this.prepareBoard(boardId, userId);
    const boardObjectId = new Types.ObjectId(boardId);
    const paceSince = new Date();
    paceSince.setMonth(paceSince.getMonth() - 3);
    const [holdings, goals, allocations, recentEvents, contributionEvents] =
      await Promise.all([
        this.holdingModel
          .find({ boardId: boardObjectId, isActive: true })
          .sort({ createdAt: 1 })
          .lean(),
        this.goalModel
          .find({
            boardId: boardObjectId,
            status: { $ne: SavingsGoalStatus.ARCHIVED },
          })
          .sort({ priority: 1, createdAt: 1 })
          .lean(),
        this.allocationModel
          .find({ boardId: boardObjectId, amount: { $gt: 0 } })
          .lean(),
        this.eventModel
          .find({ boardId: boardObjectId })
          .sort({ occurredAt: -1 })
          .limit(30)
          .lean(),
        this.eventModel
          .find({
            boardId: boardObjectId,
            occurredAt: { $gte: paceSince },
            kind: {
              $in: [WealthEventKind.CONTRIBUTION, WealthEventKind.WITHDRAWAL],
            },
          })
          .lean(),
      ]);
    const enrichedGoals = goals.map((goal) =>
      this.enrichGoal(
        goal as unknown as Record<string, unknown>,
        allocations as unknown as Array<Record<string, unknown>>,
        contributionEvents as unknown as Array<Record<string, unknown>>,
      ),
    );
    const investmentPositions = await this.positionModel
      .find({ boardId: boardObjectId, isOpen: true })
      .populate('instrumentId')
      .lean();

    return {
      holdings: holdings.map((holding) => ({
        ...holding,
        availableBalance: holding.currentBalance - holding.allocatedBalance,
      })),
      goals: enrichedGoals,
      totalsByCurrency: this.buildTotalsByCurrency(
        holdings as unknown as Array<Record<string, unknown>>,
      ),
      recentEvents,
      investmentPositions,
    };
  }

  async createHolding(dto: CreateHoldingDto, userId: string, boardId: string) {
    await this.prepareBoard(boardId, userId);
    const ownerId = new Types.ObjectId(userId);
    const boardObjectId = new Types.ObjectId(boardId);
    const holding = await new this.holdingModel({
      ...dto,
      name: dto.name.trim(),
      institution: dto.institution?.trim() || undefined,
      userId: ownerId,
      boardId: boardObjectId,
      allocatedBalance: 0,
      cashBalance:
        dto.type === HoldingType.INVESTMENT ? dto.currentBalance : undefined,
      isActive: true,
    }).save();
    await this.eventModel.create({
      userId: ownerId,
      boardId: boardObjectId,
      holdingId: holding._id,
      kind: WealthEventKind.INITIAL_BALANCE,
      amount: dto.currentBalance,
      balanceAfter: dto.currentBalance,
      occurredAt: new Date(),
    });
    return holding;
  }

  async updateHolding(
    id: string,
    dto: UpdateHoldingDto,
    userId: string,
    boardId: string,
  ) {
    await this.prepareBoard(boardId, userId);
    const holding = await this.requireHolding(id, boardId);
    if (dto.name !== undefined) holding.name = dto.name.trim();
    if (dto.type !== undefined) holding.type = dto.type;
    if (dto.institution !== undefined) {
      holding.institution = dto.institution.trim() || undefined;
    }
    return holding.save();
  }

  async adjustBalance(
    id: string,
    dto: AdjustHoldingBalanceDto,
    userId: string,
    boardId: string,
  ) {
    await this.prepareBoard(boardId, userId);
    const holding = await this.requireHolding(id, boardId);
    const previousBalance = holding.currentBalance;
    if (holding.type === HoldingType.INVESTMENT) {
      holding.cashBalance = dto.balance;
      await this.recalculateInvestmentHolding(holding);
    } else {
      holding.currentBalance = dto.balance;
    }
    if (holding.currentBalance < holding.allocatedBalance) {
      throw new BadRequestException(
        `No podés bajar el saldo por debajo de lo asignado (${holding.allocatedBalance} ${holding.currency})`,
      );
    }
    if (holding.type !== HoldingType.INVESTMENT) await holding.save();
    const delta = holding.currentBalance - previousBalance;
    await this.eventModel.create({
      userId: holding.userId,
      boardId: holding.boardId,
      holdingId: holding._id,
      kind: WealthEventKind.BALANCE_ADJUSTMENT,
      amount: delta,
      balanceAfter: holding.currentBalance,
      note: dto.note?.trim() || undefined,
      occurredAt: dto.occurredAt ? new Date(dto.occurredAt) : new Date(),
    });
    return holding;
  }

  async archiveHolding(id: string, userId: string, boardId: string) {
    await this.prepareBoard(boardId, userId);
    const holding = await this.requireHolding(id, boardId);
    if (holding.allocatedBalance > 0) {
      throw new BadRequestException(
        'Liberá primero el dinero asignado a objetivos',
      );
    }
    holding.isActive = false;
    return holding.save();
  }

  async createGoal(dto: CreateSavingsGoalDto, userId: string, boardId: string) {
    await this.prepareBoard(boardId, userId);
    return new this.goalModel({
      ...dto,
      userId: new Types.ObjectId(userId),
      boardId: new Types.ObjectId(boardId),
      name: dto.name.trim(),
      targetDate: dto.targetDate ? new Date(dto.targetDate) : undefined,
      status: SavingsGoalStatus.ACTIVE,
    }).save();
  }

  async updateGoal(
    id: string,
    dto: UpdateSavingsGoalDto,
    userId: string,
    boardId: string,
  ) {
    await this.prepareBoard(boardId, userId);
    const goal = await this.requireGoal(id, boardId);
    if (dto.name !== undefined) goal.name = dto.name.trim();
    if (dto.targetAmount !== undefined) goal.targetAmount = dto.targetAmount;
    if (dto.targetDate !== undefined)
      goal.targetDate = new Date(dto.targetDate);
    if (dto.plannedMonthlyContribution !== undefined) {
      goal.plannedMonthlyContribution = dto.plannedMonthlyContribution;
    }
    if (dto.priority !== undefined) goal.priority = dto.priority;
    if (dto.icon !== undefined) goal.icon = dto.icon.trim() || undefined;
    if (dto.status !== undefined) goal.status = dto.status;
    return goal.save();
  }

  async archiveGoal(id: string, userId: string, boardId: string) {
    await this.prepareBoard(boardId, userId);
    const goal = await this.requireGoal(id, boardId);
    const allocations = await this.allocationModel.find({
      goalId: goal._id,
      amount: { $gt: 0 },
    });
    if (allocations.length > 0) {
      throw new BadRequestException(
        'Retirá primero los aportes asignados a este objetivo',
      );
    }
    goal.status = SavingsGoalStatus.ARCHIVED;
    return goal.save();
  }

  async contribute(
    goalId: string,
    dto: CreateGoalContributionDto,
    userId: string,
    boardId: string,
  ) {
    await this.prepareBoard(boardId, userId);
    const boardObjectId = new Types.ObjectId(boardId);
    const [goal, holding] = await Promise.all([
      this.requireGoal(goalId, boardId),
      this.requireHolding(dto.holdingId, boardId),
    ]);
    if (goal.status === SavingsGoalStatus.ARCHIVED) {
      throw new BadRequestException('El objetivo está archivado');
    }
    if (goal.currency !== holding.currency) {
      throw new BadRequestException(
        'La tenencia y el objetivo deben usar la misma moneda',
      );
    }

    const ownerId = new Types.ObjectId(userId);
    const contribution = dto.kind === WealthEventKind.CONTRIBUTION;
    const signedAmount = contribution ? dto.amount : -dto.amount;
    let updatedAllocation: GoalAllocationDocument | null = null;

    if (contribution) {
      const reservedHolding = await this.holdingModel.findOneAndUpdate(
        {
          _id: holding._id,
          boardId: boardObjectId,
          isActive: true,
          $expr: {
            $gte: [
              { $subtract: ['$currentBalance', '$allocatedBalance'] },
              dto.amount,
            ],
          },
        },
        { $inc: { allocatedBalance: dto.amount } },
        { new: true },
      );
      if (!reservedHolding) {
        throw new BadRequestException(
          'El saldo disponible no alcanza para este aporte',
        );
      }
      try {
        updatedAllocation = await this.allocationModel.findOneAndUpdate(
          { goalId: goal._id, holdingId: holding._id },
          {
            $inc: { amount: dto.amount },
            $set: { userId: ownerId, boardId: boardObjectId },
            $setOnInsert: { goalId: goal._id, holdingId: holding._id },
          },
          { upsert: true, new: true },
        );
      } catch (error) {
        await this.holdingModel.updateOne(
          { _id: holding._id },
          { $inc: { allocatedBalance: -dto.amount } },
        );
        throw error;
      }
    } else {
      updatedAllocation = await this.allocationModel.findOneAndUpdate(
        {
          goalId: goal._id,
          holdingId: holding._id,
          amount: { $gte: dto.amount },
        },
        { $inc: { amount: -dto.amount } },
        { new: true },
      );
      if (!updatedAllocation) {
        throw new BadRequestException(
          'No hay suficiente dinero asignado para retirar',
        );
      }
      const releasedHolding = await this.holdingModel.findOneAndUpdate(
        {
          _id: holding._id,
          boardId: boardObjectId,
          allocatedBalance: { $gte: dto.amount },
        },
        { $inc: { allocatedBalance: -dto.amount } },
        { new: true },
      );
      if (!releasedHolding) {
        await this.allocationModel.updateOne(
          { _id: updatedAllocation._id },
          { $inc: { amount: dto.amount } },
        );
        throw new BadRequestException('No se pudo liberar el aporte');
      }
    }

    try {
      await this.eventModel.create({
        userId: ownerId,
        boardId: boardObjectId,
        holdingId: holding._id,
        goalId: goal._id,
        kind: dto.kind,
        amount: signedAmount,
        allocationAfter: updatedAllocation?.amount ?? 0,
        note: dto.note?.trim() || undefined,
        occurredAt: dto.occurredAt ? new Date(dto.occurredAt) : new Date(),
      });
    } catch (error) {
      await Promise.all([
        this.holdingModel.updateOne(
          { _id: holding._id },
          { $inc: { allocatedBalance: -signedAmount } },
        ),
        this.allocationModel.updateOne(
          { goalId: goal._id, holdingId: holding._id },
          { $inc: { amount: -signedAmount } },
        ),
      ]);
      throw error;
    }
    return this.getOverview(userId, boardId);
  }

  listInstruments(userId: string, search = '') {
    const ownerId = new Types.ObjectId(userId);
    const access = [{ isSystem: true }, { createdBy: ownerId }];
    const escaped = search.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return this.instrumentModel
      .find({
        isActive: true,
        $and: [
          { $or: access },
          ...(escaped
            ? [
                {
                  $or: [
                    { symbol: { $regex: escaped, $options: 'i' } },
                    { name: { $regex: escaped, $options: 'i' } },
                  ],
                },
              ]
            : []),
        ],
      })
      .sort({ symbol: 1 })
      .limit(50)
      .lean();
  }

  async createInstrument(dto: CreateInstrumentDto, userId: string) {
    try {
      return await new this.instrumentModel({
        ...dto,
        symbol: dto.symbol.trim().toUpperCase(),
        name: dto.name.trim(),
        exchange: dto.exchange?.trim().toUpperCase() || 'CUSTOM',
        isSystem: false,
        isActive: true,
        createdBy: new Types.ObjectId(userId),
      }).save();
    } catch {
      throw new BadRequestException('Ese instrumento ya existe');
    }
  }

  async createPosition(
    holdingId: string,
    dto: CreatePositionDto,
    userId: string,
    boardId: string,
  ) {
    await this.prepareBoard(boardId, userId);
    const holding = await this.requireInvestmentHolding(holdingId, boardId);
    const instrument = await this.instrumentModel.findById(dto.instrumentId);
    if (!instrument) throw new NotFoundException('Instrumento no encontrado');
    if (instrument.currency !== holding.currency) {
      throw new BadRequestException(
        'El instrumento y la cuenta deben usar la misma moneda',
      );
    }
    const existing = await this.positionModel.findOne({
      holdingId: holding._id,
      instrumentId: instrument._id,
    });
    if (existing?.isOpen)
      throw new BadRequestException('La posición ya existe');
    const position = existing
      ? Object.assign(existing, { ...dto, isOpen: true })
      : new this.positionModel({
          userId: holding.userId,
          boardId: holding.boardId,
          holdingId: holding._id,
          instrumentId: instrument._id,
          quantity: dto.quantity,
          averageCost: dto.averageCost,
          currentPrice: dto.currentPrice,
          isOpen: true,
        });
    await position.save();
    await this.recalculateInvestmentHolding(holding);
    return position;
  }

  async updatePositionPrice(
    positionId: string,
    dto: UpdatePositionPriceDto,
    userId: string,
    boardId: string,
  ) {
    await this.prepareBoard(boardId, userId);
    const position = await this.positionModel.findOne({
      _id: new Types.ObjectId(positionId),
      boardId: new Types.ObjectId(boardId),
    });
    if (!position) throw new NotFoundException('Posición no encontrada');
    position.currentPrice = dto.currentPrice;
    await position.save();
    const holding = await this.requireInvestmentHolding(
      position.holdingId.toString(),
      boardId,
    );
    await this.recalculateInvestmentHolding(holding);
    return position;
  }

  async trade(
    holdingId: string,
    dto: CreateInvestmentTransactionDto,
    userId: string,
    boardId: string,
  ) {
    await this.prepareBoard(boardId, userId);
    const holding = await this.requireInvestmentHolding(holdingId, boardId);
    const position = await this.positionModel.findOne({
      holdingId: holding._id,
      instrumentId: new Types.ObjectId(dto.instrumentId),
      isOpen: true,
    });
    if (!position) throw new NotFoundException('Posición no encontrada');
    const fees = dto.fees ?? 0;
    const cash = holding.cashBalance ?? 0;
    if (dto.type === InvestmentTransactionType.BUY) {
      const total = dto.quantity * dto.unitPrice + fees;
      if (cash < total)
        throw new BadRequestException('El efectivo disponible no alcanza');
      const previousCost = position.quantity * position.averageCost;
      position.quantity += dto.quantity;
      position.averageCost =
        (previousCost + dto.quantity * dto.unitPrice + fees) /
        position.quantity;
      holding.cashBalance = cash - total;
    } else {
      if (dto.quantity > position.quantity) {
        throw new BadRequestException(
          'No hay nominales suficientes para vender',
        );
      }
      const resultingCash = cash + dto.quantity * dto.unitPrice - fees;
      if (resultingCash < 0) {
        throw new BadRequestException(
          'Las comisiones superan el efectivo y el importe de la venta',
        );
      }
      position.quantity -= dto.quantity;
      position.isOpen = position.quantity > 0;
      holding.cashBalance = resultingCash;
    }
    position.currentPrice = dto.unitPrice;
    await position.save();
    await this.transactionModel.create({
      ...dto,
      userId: holding.userId,
      boardId: holding.boardId,
      holdingId: holding._id,
      instrumentId: position.instrumentId,
      fees,
      occurredAt: dto.occurredAt ? new Date(dto.occurredAt) : new Date(),
    });
    await this.recalculateInvestmentHolding(holding);
    return this.getOverview(userId, boardId);
  }

  private async requireInvestmentHolding(id: string, boardId: string) {
    const holding = await this.requireHolding(id, boardId);
    if (holding.type !== HoldingType.INVESTMENT) {
      throw new BadRequestException(
        'La tenencia no es una cuenta de inversión',
      );
    }
    return holding;
  }

  private async recalculateInvestmentHolding(holding: HoldingDocument) {
    const positions = await this.positionModel
      .find({ holdingId: holding._id, isOpen: true })
      .lean();
    holding.currentBalance =
      (holding.cashBalance ?? 0) +
      positions.reduce(
        (sum, position) => sum + position.quantity * position.currentPrice,
        0,
      );
    if (holding.currentBalance < holding.allocatedBalance) {
      throw new BadRequestException(
        'La valuación queda debajo del dinero asignado',
      );
    }
    await holding.save();
  }

  private async prepareBoard(boardId: string, userId: string) {
    await this.participantsService.ensureBoardParticipantAccess(
      boardId,
      userId,
    );
    const boardObjectId = new Types.ObjectId(boardId);
    const board = await this.boardModel.findById(boardObjectId).lean();
    if (!board) throw new NotFoundException('Tablero no encontrado');

    // Compatibility migration for wealth created before it was board-scoped.
    // It is safe to attach only when this is still the creator's active board.
    const creator = await this.userModel
      .findById(board.createdBy)
      .select('activeBoardId')
      .lean();
    if (creator?.activeBoardId?.toString() !== boardId) return;

    const legacyFilter = {
      userId: board.createdBy,
      boardId: { $exists: false },
    };
    await Promise.all([
      this.holdingModel.updateMany(legacyFilter, {
        $set: { boardId: boardObjectId },
      }),
      this.goalModel.updateMany(legacyFilter, {
        $set: { boardId: boardObjectId },
      }),
      this.allocationModel.updateMany(legacyFilter, {
        $set: { boardId: boardObjectId },
      }),
      this.eventModel.updateMany(legacyFilter, {
        $set: { boardId: boardObjectId },
      }),
      this.positionModel.updateMany(legacyFilter, {
        $set: { boardId: boardObjectId },
      }),
      this.transactionModel.updateMany(legacyFilter, {
        $set: { boardId: boardObjectId },
      }),
    ]);
  }

  private async requireHolding(id: string, boardId: string) {
    const holding = await this.holdingModel.findOne({
      _id: new Types.ObjectId(id),
      boardId: new Types.ObjectId(boardId),
    });
    if (!holding) throw new NotFoundException('Tenencia no encontrada');
    return holding;
  }

  private async requireGoal(id: string, boardId: string) {
    const goal = await this.goalModel.findOne({
      _id: new Types.ObjectId(id),
      boardId: new Types.ObjectId(boardId),
    });
    if (!goal) throw new NotFoundException('Objetivo no encontrado');
    return goal;
  }

  private buildTotalsByCurrency(holdings: Array<Record<string, unknown>>) {
    const totals: Record<
      string,
      { balance: number; allocated: number; available: number }
    > = {};
    for (const holding of holdings) {
      const currency = String(holding.currency);
      const balance = Number(holding.currentBalance);
      const allocated = Number(holding.allocatedBalance);
      totals[currency] ??= { balance: 0, allocated: 0, available: 0 };
      totals[currency].balance += balance;
      totals[currency].allocated += allocated;
      totals[currency].available += balance - allocated;
    }
    return totals;
  }

  private enrichGoal(
    goal: Record<string, unknown>,
    allocations: Array<Record<string, unknown>>,
    events: Array<Record<string, unknown>>,
  ): GoalWithProgress {
    const goalId = String(goal._id);
    const goalAllocations = allocations.filter(
      (item) => String(item.goalId) === goalId,
    );
    const allocatedAmount = goalAllocations.reduce(
      (sum, item) => sum + Number(item.amount),
      0,
    );
    const targetAmount = Number(goal.targetAmount);
    const remainingAmount = Math.max(0, targetAmount - allocatedAmount);
    const progressPercent =
      targetAmount > 0
        ? Math.min(100, (allocatedAmount / targetAmount) * 100)
        : 0;
    const rawTargetDate = goal.targetDate;
    const targetDate =
      rawTargetDate instanceof Date
        ? rawTargetDate
        : typeof rawTargetDate === 'string' || typeof rawTargetDate === 'number'
          ? new Date(rawTargetDate)
          : null;
    const monthsRemaining = targetDate ? this.monthsUntil(targetDate) : null;
    const requiredMonthlyContribution =
      monthsRemaining === null
        ? null
        : remainingAmount / Math.max(1, monthsRemaining);
    const since = new Date();
    since.setMonth(since.getMonth() - 3);
    const recentNet = events
      .filter(
        (event) =>
          String(event.goalId) === goalId &&
          new Date(String(event.occurredAt)) >= since,
      )
      .reduce((sum, event) => sum + Number(event.amount), 0);
    const actualMonthlyContribution = Math.max(0, recentNet / 3);
    const pace =
      actualMonthlyContribution || Number(goal.plannedMonthlyContribution ?? 0);
    const monthsToGoal = pace > 0 ? Math.ceil(remainingAmount / pace) : null;
    const estimated = monthsToGoal === null ? null : new Date();
    if (estimated && monthsToGoal !== null) {
      estimated.setMonth(estimated.getMonth() + monthsToGoal);
    }
    const completed = remainingAmount === 0;
    const paceStatus = completed
      ? 'completed'
      : !pace
        ? 'no_plan'
        : targetDate && estimated && estimated > targetDate
          ? 'behind'
          : 'on_track';

    return {
      ...goal,
      allocatedAmount,
      remainingAmount,
      progressPercent,
      requiredMonthlyContribution,
      actualMonthlyContribution,
      estimatedCompletionDate: estimated?.toISOString() ?? null,
      paceStatus,
      allocations: goalAllocations,
    };
  }

  private monthsUntil(target: Date): number {
    const now = new Date();
    return Math.max(
      1,
      (target.getFullYear() - now.getFullYear()) * 12 +
        target.getMonth() -
        now.getMonth() +
        1,
    );
  }
}
