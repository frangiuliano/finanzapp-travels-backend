import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  CreateGoalDto,
  GoalHoldingSelectionInputDto,
  PreviewGoalDto,
  UpdateGoalDto,
  UpdateGoalHoldingsDto,
} from './goals.dto';
import {
  Goal,
  GoalCheckpoint,
  GoalCheckpointDocument,
  GoalDocument,
  GoalHoldingSelection,
  GoalHoldingSelectionDocument,
  GoalStatus,
} from './goals.schemas';
import {
  GoalsPlannerService,
  PlannerGoalInput,
  PlannerGoalResult,
  PlannerHoldingSelectionInput,
  PlannerInput,
  PlannerResult,
} from './goals-planner.service';
import { Holding, HoldingDocument } from '../wealth/wealth.schemas';
import { Board, BoardDocument } from '../trips/board.schema';
import { ParticipantsService } from '../participants/participants.service';
import { ForecastService } from '../forecast/forecast.service';
import { FxService } from '../fx/fx.service';
import {
  getCurrentYearMonth,
  monthsBetweenYearMonths,
} from '../common/utils/parse-year-month';
import { MAX_PLANNING_HORIZON_MONTHS } from '../common/constants/recurring-horizon';

const HORIZON_MONTHS = MAX_PLANNING_HORIZON_MONTHS;

export interface LeanGoal {
  _id: Types.ObjectId;
  boardId: Types.ObjectId;
  createdBy: Types.ObjectId;
  name: string;
  icon?: string;
  targetAmount: number;
  currency: string;
  targetDate?: Date;
  desiredMonthlyContribution?: number;
  priority: number;
  status: GoalStatus;
  useEstimatedFxForForecast: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface LeanSelection {
  _id: Types.ObjectId;
  goalId: Types.ObjectId;
  holdingId: Types.ObjectId;
  useEstimatedFx: boolean;
}

export interface GoalWithResult {
  goal: LeanGoal;
  selections: LeanSelection[];
  result: PlannerGoalResult;
}

@Injectable()
export class GoalsService {
  private readonly logger = new Logger(GoalsService.name);

  constructor(
    @InjectModel(Goal.name) private goalModel: Model<GoalDocument>,
    @InjectModel(GoalHoldingSelection.name)
    private selectionModel: Model<GoalHoldingSelectionDocument>,
    @InjectModel(GoalCheckpoint.name)
    private checkpointModel: Model<GoalCheckpointDocument>,
    @InjectModel(Holding.name) private holdingModel: Model<HoldingDocument>,
    @InjectModel(Board.name) private boardModel: Model<BoardDocument>,
    private participantsService: ParticipantsService,
    private forecastService: ForecastService,
    private fxService: FxService,
    private planner: GoalsPlannerService,
  ) {}

  async listGoals(userId: string, boardId: string) {
    await this.participantsService.ensureBoardParticipantAccess(
      boardId,
      userId,
    );
    const board = await this.requireBoard(boardId);
    const goals = await this.goalModel
      .find({
        boardId: board._id,
        status: { $ne: GoalStatus.ARCHIVED },
      })
      .sort({ priority: 1, createdAt: 1 })
      .lean<LeanGoal[]>();

    const { plannerResult, selectionsByGoal } = await this.evaluateGoals(
      userId,
      board,
      goals,
    );
    await this.captureCheckpoints(board._id, goals, plannerResult);

    return this.buildResponse(goals, selectionsByGoal, plannerResult);
  }

  async getGoal(id: string, userId: string, boardId: string) {
    await this.participantsService.ensureBoardParticipantAccess(
      boardId,
      userId,
    );
    const board = await this.requireBoard(boardId);
    const goal = (
      await this.requireGoal(id, board._id)
    ).toObject() as unknown as LeanGoal;
    const { plannerResult, selectionsByGoal } = await this.evaluateGoals(
      userId,
      board,
      [goal],
    );
    await this.captureCheckpoints(board._id, [goal], plannerResult);
    return this.buildResponse([goal], selectionsByGoal, plannerResult).goals[0];
  }

  async createGoal(dto: CreateGoalDto, userId: string, boardId: string) {
    await this.participantsService.ensureBoardParticipantAccess(
      boardId,
      userId,
    );
    const board = await this.requireBoard(boardId);
    const holdingIds = (dto.holdingSelections ?? []).map((s) => s.holdingId);
    await this.validateHoldingIds(board._id, holdingIds);

    const goal = await new this.goalModel({
      boardId: board._id,
      createdBy: new Types.ObjectId(userId),
      name: dto.name.trim(),
      icon: dto.icon?.trim() || undefined,
      targetAmount: dto.targetAmount,
      currency: dto.currency,
      targetDate: dto.targetDate ? new Date(dto.targetDate) : undefined,
      desiredMonthlyContribution: dto.desiredMonthlyContribution,
      priority: dto.priority ?? 5,
      status: GoalStatus.ACTIVE,
      useEstimatedFxForForecast: dto.useEstimatedFxForForecast ?? false,
    }).save();

    await this.replaceSelections(
      board._id,
      goal._id,
      userId,
      dto.holdingSelections ?? [],
    );

    return this.getGoal(goal._id.toString(), userId, boardId);
  }

  async updateGoal(
    id: string,
    dto: UpdateGoalDto,
    userId: string,
    boardId: string,
  ) {
    await this.participantsService.ensureBoardParticipantAccess(
      boardId,
      userId,
    );
    const board = await this.requireBoard(boardId);
    const goal = await this.requireGoal(id, board._id);

    if (dto.name !== undefined) goal.name = dto.name.trim();
    if (dto.icon !== undefined) goal.icon = dto.icon.trim() || undefined;
    if (dto.targetAmount !== undefined) goal.targetAmount = dto.targetAmount;
    if (dto.targetDate !== undefined) {
      goal.targetDate = new Date(dto.targetDate);
    }
    if (dto.desiredMonthlyContribution !== undefined) {
      goal.desiredMonthlyContribution = dto.desiredMonthlyContribution;
    }
    if (dto.priority !== undefined) goal.priority = dto.priority;
    if (dto.status !== undefined) goal.status = dto.status;
    if (dto.useEstimatedFxForForecast !== undefined) {
      goal.useEstimatedFxForForecast = dto.useEstimatedFxForForecast;
    }
    await goal.save();

    return this.getGoal(id, userId, boardId);
  }

  async updateGoalHoldings(
    id: string,
    dto: UpdateGoalHoldingsDto,
    userId: string,
    boardId: string,
  ) {
    await this.participantsService.ensureBoardParticipantAccess(
      boardId,
      userId,
    );
    const board = await this.requireBoard(boardId);
    const goal = await this.requireGoal(id, board._id);
    const holdingIds = dto.holdingSelections.map((s) => s.holdingId);
    await this.validateHoldingIds(board._id, holdingIds);
    await this.replaceSelections(
      board._id,
      goal._id,
      userId,
      dto.holdingSelections,
    );
    return this.getGoal(id, userId, boardId);
  }

  /**
   * Hard-deletes a goal only when it has no tracked history (no real
   * checkpoints beyond a migration baseline) — otherwise the caller should
   * archive it instead (PATCH status=archived) to keep its history intact.
   */
  async deleteGoal(id: string, userId: string, boardId: string) {
    await this.participantsService.ensureBoardParticipantAccess(
      boardId,
      userId,
    );
    const board = await this.requireBoard(boardId);
    const goal = await this.requireGoal(id, board._id);
    const realCheckpoints = await this.checkpointModel.countDocuments({
      goalId: goal._id,
      isBaseline: false,
    });
    if (realCheckpoints > 0) {
      throw new BadRequestException(
        'Este objetivo ya tiene historial de seguimiento. Archivalo en vez de eliminarlo.',
      );
    }
    await Promise.all([
      this.goalModel.deleteOne({ _id: goal._id }),
      this.selectionModel.deleteMany({ goalId: goal._id }),
      this.checkpointModel.deleteMany({ goalId: goal._id }),
    ]);
  }

  async getProgress(id: string, userId: string, boardId: string) {
    await this.participantsService.ensureBoardParticipantAccess(
      boardId,
      userId,
    );
    const board = await this.requireBoard(boardId);
    const goal = await this.requireGoal(id, board._id);
    const checkpoints = await this.checkpointModel
      .find({ goalId: goal._id })
      .sort({ yearMonth: 1 })
      .lean();

    if (checkpoints.length < 2) {
      return {
        hasEnoughData: false,
        message:
          'Todavía no tenemos suficientes mediciones para evaluar el avance mensual.',
        checkpoints,
      };
    }

    const { plannerResult } = await this.evaluateGoals(userId, board, [
      goal.toObject() as unknown as LeanGoal,
    ]);
    const current = plannerResult.goals[0];

    const months = checkpoints.slice(1).map((checkpoint, index) => {
      const previous = checkpoints[index];
      const observedAdvance =
        checkpoint.totalConsideredValue - previous.totalConsideredValue;
      const expectedAdvance =
        current.requiredMonthlyContributionIndividual ?? 0;
      return {
        yearMonth: checkpoint.yearMonth,
        observedAdvance,
        expectedAdvance,
        difference: observedAdvance - expectedAdvance,
        met: observedAdvance >= expectedAdvance,
      };
    });

    return {
      hasEnoughData: true,
      note: 'El aporte esperado usa el ritmo requerido actual como referencia para todos los meses históricos, no el vigente en cada mes pasado.',
      months,
      monthsMet: months.filter((m) => m.met).length,
      monthsMissed: months.filter((m) => !m.met).length,
      currentRequiredMonthlyContribution:
        current.requiredMonthlyContributionIndividual,
      currentEstimatedCompletionYearMonth:
        current.estimatedCompletionYearMonthIndividual,
    };
  }

  /**
   * Evaluates a not-yet-saved scenario (a new goal, or edits to an existing
   * one) against the board's current goals WITHOUT persisting anything, then
   * reports how the scenario itself and every other affected active goal's
   * joint viability compares to the current persisted state. Uses the exact
   * same evaluateGoals()/planner.evaluate() path as create/update, so
   * preview and save can never disagree.
   */
  async preview(dto: PreviewGoalDto, userId: string, boardId: string) {
    await this.participantsService.ensureBoardParticipantAccess(
      boardId,
      userId,
    );
    const board = await this.requireBoard(boardId);
    const holdingIds = dto.holdingSelections.map((s) => s.holdingId);
    await this.validateHoldingIds(board._id, holdingIds);

    const persistedGoals = await this.goalModel
      .find({ boardId: board._id, status: { $ne: GoalStatus.ARCHIVED } })
      .lean<LeanGoal[]>();

    const editingId = dto.goalId;
    if (
      editingId &&
      !persistedGoals.some((g) => g._id.toString() === editingId)
    ) {
      throw new NotFoundException('Objetivo no encontrado');
    }

    const candidateId =
      editingId ?? `preview:${new Types.ObjectId().toString()}`;
    const originalGoal = editingId
      ? persistedGoals.find((g) => g._id.toString() === editingId)
      : undefined;
    const candidateGoal: LeanGoal = {
      _id:
        originalGoal?._id ??
        new Types.ObjectId(candidateId.replace('preview:', '')),
      boardId: board._id,
      createdBy: originalGoal?.createdBy ?? new Types.ObjectId(userId),
      name: dto.name,
      icon: dto.icon,
      targetAmount: dto.targetAmount,
      currency: dto.currency,
      targetDate: dto.targetDate ? new Date(dto.targetDate) : undefined,
      desiredMonthlyContribution: dto.desiredMonthlyContribution,
      priority: dto.priority ?? 5,
      status: dto.status ?? GoalStatus.ACTIVE,
      useEstimatedFxForForecast: dto.useEstimatedFxForForecast ?? false,
      createdAt: originalGoal?.createdAt ?? new Date(),
      updatedAt: new Date(),
    };
    const candidateSelections: LeanSelection[] = dto.holdingSelections.map(
      (s) => ({
        _id: new Types.ObjectId(),
        goalId: candidateGoal._id,
        holdingId: new Types.ObjectId(s.holdingId),
        useEstimatedFx: s.useEstimatedFx ?? false,
      }),
    );

    const baselineGoals = persistedGoals;
    const candidateGoals = editingId
      ? persistedGoals.map((g) =>
          g._id.toString() === editingId ? candidateGoal : g,
        )
      : [...persistedGoals, candidateGoal];

    const [baseline, candidate] = await Promise.all([
      this.evaluateGoals(userId, board, baselineGoals),
      this.evaluateGoals(userId, board, candidateGoals, {
        [candidateGoal._id.toString()]: candidateSelections,
      }),
    ]);

    const candidateResult = candidate.plannerResult.goals.find(
      (g) => g.goalId === candidateGoal._id.toString(),
    )!;

    const affected = candidateGoals
      .filter((g) => g._id.toString() !== candidateGoal._id.toString())
      .map((g) => {
        const before = baseline.plannerResult.goals.find(
          (r) => r.goalId === g._id.toString(),
        );
        const after = candidate.plannerResult.goals.find(
          (r) => r.goalId === g._id.toString(),
        );
        return { goal: g, before, after };
      })
      .filter(
        ({ before, after }) =>
          before &&
          after &&
          (before.viableJoint !== after.viableJoint ||
            before.estimatedCompletionYearMonthJoint !==
              after.estimatedCompletionYearMonthJoint),
      )
      .map(({ goal, before, after }) => ({
        goalId: goal._id.toString(),
        name: goal.name,
        before,
        after,
      }));

    return {
      candidate: candidateResult,
      affectedGoals: affected,
    };
  }

  private async evaluateGoals(
    userId: string,
    board: BoardDocument,
    goals: LeanGoal[],
    selectionsOverride?: Record<string, LeanSelection[]>,
  ): Promise<{
    plannerResult: PlannerResult;
    selectionsByGoal: Map<string, LeanSelection[]>;
  }> {
    const goalIds = goals.map((g) => g._id);
    const fetchedSelections = goalIds.length
      ? await this.selectionModel
          .find({ goalId: { $in: goalIds } })
          .lean<LeanSelection[]>()
      : [];

    const selectionsByGoal = new Map<string, LeanSelection[]>();
    for (const goal of goals) {
      const id = goal._id.toString();
      selectionsByGoal.set(
        id,
        selectionsOverride?.[id] ??
          fetchedSelections.filter((s) => s.goalId.toString() === id),
      );
    }

    const holdingIds = [
      ...new Set(
        [...selectionsByGoal.values()]
          .flat()
          .map((s) => s.holdingId.toString()),
      ),
    ];
    const holdingDocs = holdingIds.length
      ? await this.holdingModel
          .find({
            _id: { $in: holdingIds.map((id) => new Types.ObjectId(id)) },
          })
          .lean()
      : [];
    const holdingsById = new Map(holdingDocs.map((h) => [h._id.toString(), h]));

    const fxRateCache = await this.resolveFxRates(
      goals,
      selectionsByGoal,
      holdingsById,
      board,
    );

    const currentYearMonth = getCurrentYearMonth();
    const neededMonths = this.resolveNeededMonths(goals, currentYearMonth);
    const monthlyCapacity = await this.buildCapacitySeries(
      board._id.toString(),
      userId,
      currentYearMonth,
      neededMonths,
    );

    const plannerGoals: PlannerGoalInput[] = goals.map((goal) => {
      const selections = selectionsByGoal.get(goal._id.toString()) ?? [];
      const holdingSelections: PlannerHoldingSelectionInput[] = selections.map(
        (selection) => {
          const holding = holdingsById.get(selection.holdingId.toString());
          const rate =
            holding &&
            selection.useEstimatedFx &&
            holding.currency !== goal.currency
              ? fxRateCache.get(`${holding.currency}:${goal.currency}`)
              : undefined;
          return {
            holdingId: selection.holdingId.toString(),
            useEstimatedFx: selection.useEstimatedFx,
            estimatedFxRateToGoalCurrency: rate ?? undefined,
          };
        },
      );
      const forecastRate =
        goal.useEstimatedFxForForecast && goal.currency !== board.baseCurrency
          ? fxRateCache.get(`${board.baseCurrency}:${goal.currency}`)
          : undefined;

      return {
        id: goal._id.toString(),
        targetAmount: goal.targetAmount,
        currency: goal.currency,
        targetYearMonth: goal.targetDate
          ? getCurrentYearMonth(new Date(goal.targetDate))
          : null,
        desiredMonthlyContribution: goal.desiredMonthlyContribution ?? null,
        priority: goal.priority,
        status: goal.status,
        createdAtMs: new Date(goal.createdAt).getTime(),
        holdingSelections,
        useEstimatedFxForForecast: goal.useEstimatedFxForForecast,
        estimatedForecastFxRate: forecastRate ?? undefined,
      };
    });

    const holdingsSnapshot: PlannerInput['holdings'] = {};
    for (const [id, holding] of holdingsById.entries()) {
      holdingsSnapshot[id] = {
        currency: holding.currency,
        currentBalance: holding.currentBalance,
      };
    }

    const plannerInput: PlannerInput = {
      boardCurrency: board.baseCurrency,
      currentYearMonth,
      horizonMonths: HORIZON_MONTHS,
      goals: plannerGoals,
      holdings: holdingsSnapshot,
      monthlyCapacity,
    };

    return {
      plannerResult: this.planner.evaluate(plannerInput),
      selectionsByGoal,
    };
  }

  private resolveNeededMonths(goals: LeanGoal[], currentYearMonth: string) {
    let needed = 1;
    for (const goal of goals) {
      if (
        goal.status !== GoalStatus.ACTIVE &&
        goal.status !== GoalStatus.PAUSED
      ) {
        continue;
      }
      if (!goal.targetDate) {
        needed = HORIZON_MONTHS;
        break;
      }
      const targetYearMonth = getCurrentYearMonth(new Date(goal.targetDate));
      const months = monthsBetweenYearMonths(currentYearMonth, targetYearMonth);
      needed = Math.max(needed, Math.min(HORIZON_MONTHS, Math.max(1, months)));
    }
    return needed;
  }

  private async buildCapacitySeries(
    boardId: string,
    userId: string,
    currentYearMonth: string,
    monthsCount: number,
  ) {
    try {
      const forecasts = await this.forecastService.getMonthlyForecastRange(
        boardId,
        userId,
        currentYearMonth,
        monthsCount,
      );
      return forecasts.map((f) => ({
        yearMonth: f.yearMonth,
        projectedRemaining: f.planned.projectedRemaining,
      }));
    } catch (error) {
      this.logger.warn(
        `No se pudo calcular la capacidad futura para el tablero ${boardId}: ${error instanceof Error ? error.message : error}`,
      );
      return [];
    }
  }

  private async resolveFxRates(
    goals: LeanGoal[],
    selectionsByGoal: Map<string, LeanSelection[]>,
    holdingsById: Map<string, { currency: string }>,
    board: BoardDocument,
  ): Promise<Map<string, number>> {
    const pairs = new Set<string>();
    for (const goal of goals) {
      const selections = selectionsByGoal.get(goal._id.toString()) ?? [];
      for (const selection of selections) {
        if (!selection.useEstimatedFx) continue;
        const holding = holdingsById.get(selection.holdingId.toString());
        if (holding && holding.currency !== goal.currency) {
          pairs.add(`${holding.currency}:${goal.currency}`);
        }
      }
      if (
        goal.useEstimatedFxForForecast &&
        goal.currency !== board.baseCurrency
      ) {
        pairs.add(`${board.baseCurrency}:${goal.currency}`);
      }
    }

    const rates = new Map<string, number>();
    await Promise.all(
      [...pairs].map(async (pair) => {
        const [from, to] = pair.split(':');
        try {
          const snapshot = await this.fxService.resolveSnapshot(from, to);
          rates.set(pair, snapshot.fxRateToBoardCurrency);
        } catch (error) {
          this.logger.warn(
            `No se pudo resolver la cotización ${from}->${to}: ${error instanceof Error ? error.message : error}`,
          );
        }
      }),
    );
    return rates;
  }

  private async captureCheckpoints(
    boardId: Types.ObjectId,
    goals: LeanGoal[],
    plannerResult: PlannerResult,
  ) {
    const yearMonth = plannerResult.currentYearMonth;
    await Promise.all(
      goals
        .filter((goal) => goal.status !== GoalStatus.ARCHIVED)
        .map(async (goal) => {
          const result = plannerResult.goals.find(
            (g) => g.goalId === goal._id.toString(),
          );
          if (!result) return;
          await this.checkpointModel.updateOne(
            { goalId: goal._id, yearMonth },
            {
              $setOnInsert: {
                boardId,
                goalId: goal._id,
                yearMonth,
                totalConsideredValue: result.currentComputableValueIndividual,
                valueByHolding: result.holdingContributions.map((h) => ({
                  holdingId: new Types.ObjectId(h.holdingId),
                  currency: h.currency,
                  value: h.valueInGoalCurrencyIndividual ?? 0,
                  computable: h.computable,
                })),
                isBaseline: false,
                capturedAt: new Date(),
              },
            },
            { upsert: true },
          );
        }),
    );
  }

  private buildResponse(
    goals: LeanGoal[],
    selectionsByGoal: Map<string, LeanSelection[]>,
    plannerResult: PlannerResult,
  ) {
    const enriched = goals.map((goal) => {
      const id = goal._id.toString();
      const result = plannerResult.goals.find((g) => g.goalId === id)!;
      return {
        goal,
        selections: selectionsByGoal.get(id) ?? [],
        result,
      };
    });

    const active = enriched.filter((g) => g.goal.status === GoalStatus.ACTIVE);
    const summary = {
      total: enriched.length,
      achievable: enriched.filter(
        (g) =>
          g.goal.status === GoalStatus.COMPLETED ||
          (g.goal.status === GoalStatus.ACTIVE &&
            g.result.viableJoint === true),
      ).length,
      atRisk: active.filter((g) => g.result.viableJoint === false).length,
      insufficientData: active.filter((g) => g.result.viableJoint === null)
        .length,
    };

    return { goals: enriched, summary };
  }

  private async replaceSelections(
    boardId: Types.ObjectId,
    goalId: Types.ObjectId,
    userId: string,
    selections: GoalHoldingSelectionInputDto[],
  ) {
    await this.selectionModel.deleteMany({ goalId });
    if (!selections.length) return;
    await this.selectionModel.insertMany(
      selections.map((s) => ({
        boardId,
        goalId,
        holdingId: new Types.ObjectId(s.holdingId),
        useEstimatedFx: s.useEstimatedFx ?? false,
        selectedBy: new Types.ObjectId(userId),
      })),
    );
  }

  private async validateHoldingIds(boardId: Types.ObjectId, ids: string[]) {
    if (!ids.length) return;
    const unique = [...new Set(ids)];
    const found = await this.holdingModel
      .find({
        _id: { $in: unique.map((id) => new Types.ObjectId(id)) },
        boardId,
      })
      .select('_id')
      .lean();
    if (found.length !== unique.length) {
      throw new BadRequestException(
        'Una o más tenencias no pertenecen a este tablero',
      );
    }
  }

  private async requireBoard(boardId: string) {
    const board = await this.boardModel.findById(boardId);
    if (!board) throw new NotFoundException('Tablero no encontrado');
    return board;
  }

  private async requireGoal(id: string, boardId: Types.ObjectId) {
    const goal = await this.goalModel.findOne({
      _id: new Types.ObjectId(id),
      boardId,
    });
    if (!goal) throw new NotFoundException('Objetivo no encontrado');
    return goal;
  }
}
