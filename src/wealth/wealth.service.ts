import {
  BadRequestException,
  Injectable,
  NotFoundException,
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
} from './wealth.dto';
import {
  GoalAllocation,
  GoalAllocationDocument,
  Holding,
  HoldingDocument,
  SavingsGoal,
  SavingsGoalDocument,
  SavingsGoalStatus,
  WealthEvent,
  WealthEventDocument,
  WealthEventKind,
} from './wealth.schemas';

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
export class WealthService {
  constructor(
    @InjectModel(Holding.name) private holdingModel: Model<HoldingDocument>,
    @InjectModel(SavingsGoal.name)
    private goalModel: Model<SavingsGoalDocument>,
    @InjectModel(GoalAllocation.name)
    private allocationModel: Model<GoalAllocationDocument>,
    @InjectModel(WealthEvent.name)
    private eventModel: Model<WealthEventDocument>,
  ) {}

  async getOverview(userId: string) {
    const ownerId = new Types.ObjectId(userId);
    const paceSince = new Date();
    paceSince.setMonth(paceSince.getMonth() - 3);
    const [holdings, goals, allocations, recentEvents, contributionEvents] =
      await Promise.all([
        this.holdingModel
          .find({ userId: ownerId, isActive: true })
          .sort({ createdAt: 1 })
          .lean(),
        this.goalModel
          .find({
            userId: ownerId,
            status: { $ne: SavingsGoalStatus.ARCHIVED },
          })
          .sort({ priority: 1, createdAt: 1 })
          .lean(),
        this.allocationModel
          .find({ userId: ownerId, amount: { $gt: 0 } })
          .lean(),
        this.eventModel
          .find({ userId: ownerId })
          .sort({ occurredAt: -1 })
          .limit(30)
          .lean(),
        this.eventModel
          .find({
            userId: ownerId,
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
    };
  }

  async createHolding(dto: CreateHoldingDto, userId: string) {
    const ownerId = new Types.ObjectId(userId);
    const holding = await new this.holdingModel({
      ...dto,
      name: dto.name.trim(),
      institution: dto.institution?.trim() || undefined,
      userId: ownerId,
      allocatedBalance: 0,
      isActive: true,
    }).save();
    await this.eventModel.create({
      userId: ownerId,
      holdingId: holding._id,
      kind: WealthEventKind.INITIAL_BALANCE,
      amount: dto.currentBalance,
      balanceAfter: dto.currentBalance,
      occurredAt: new Date(),
    });
    return holding;
  }

  async updateHolding(id: string, dto: UpdateHoldingDto, userId: string) {
    const holding = await this.requireHolding(id, userId);
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
  ) {
    const holding = await this.requireHolding(id, userId);
    if (dto.balance < holding.allocatedBalance) {
      throw new BadRequestException(
        `No podés bajar el saldo por debajo de lo asignado (${holding.allocatedBalance} ${holding.currency})`,
      );
    }
    const delta = dto.balance - holding.currentBalance;
    holding.currentBalance = dto.balance;
    await holding.save();
    await this.eventModel.create({
      userId: holding.userId,
      holdingId: holding._id,
      kind: WealthEventKind.BALANCE_ADJUSTMENT,
      amount: delta,
      balanceAfter: dto.balance,
      note: dto.note?.trim() || undefined,
      occurredAt: dto.occurredAt ? new Date(dto.occurredAt) : new Date(),
    });
    return holding;
  }

  async archiveHolding(id: string, userId: string) {
    const holding = await this.requireHolding(id, userId);
    if (holding.allocatedBalance > 0) {
      throw new BadRequestException(
        'Liberá primero el dinero asignado a objetivos',
      );
    }
    holding.isActive = false;
    return holding.save();
  }

  async createGoal(dto: CreateSavingsGoalDto, userId: string) {
    return new this.goalModel({
      ...dto,
      userId: new Types.ObjectId(userId),
      name: dto.name.trim(),
      targetDate: dto.targetDate ? new Date(dto.targetDate) : undefined,
      status: SavingsGoalStatus.ACTIVE,
    }).save();
  }

  async updateGoal(id: string, dto: UpdateSavingsGoalDto, userId: string) {
    const goal = await this.requireGoal(id, userId);
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

  async archiveGoal(id: string, userId: string) {
    const goal = await this.requireGoal(id, userId);
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
  ) {
    const [goal, holding] = await Promise.all([
      this.requireGoal(goalId, userId),
      this.requireHolding(dto.holdingId, userId),
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
          userId: ownerId,
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
            $set: { userId: ownerId },
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
          userId: ownerId,
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
    return this.getOverview(userId);
  }

  private async requireHolding(id: string, userId: string) {
    const holding = await this.holdingModel.findOne({
      _id: new Types.ObjectId(id),
      userId: new Types.ObjectId(userId),
    });
    if (!holding) throw new NotFoundException('Tenencia no encontrada');
    return holding;
  }

  private async requireGoal(id: string, userId: string) {
    const goal = await this.goalModel.findOne({
      _id: new Types.ObjectId(id),
      userId: new Types.ObjectId(userId),
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
