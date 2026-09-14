import { Injectable } from '@nestjs/common';
import {
  monthsBetweenYearMonths,
  shiftYearMonth,
} from '../common/utils/parse-year-month';
import { GoalStatus } from './goals.schemas';

export interface PlannerHoldingSnapshot {
  currency: string;
  currentBalance: number;
}

export interface PlannerHoldingSelectionInput {
  holdingId: string;
  useEstimatedFx: boolean;
  /** 1 unit of the holding's currency = this many units of the goal's currency. Only set when useEstimatedFx is true and currencies differ. */
  estimatedFxRateToGoalCurrency?: number;
}

export interface PlannerGoalInput {
  id: string;
  targetAmount: number;
  currency: string;
  /** YYYY-MM derived from targetDate, or null when no target date is set. */
  targetYearMonth: string | null;
  desiredMonthlyContribution: number | null;
  priority: number;
  status: GoalStatus;
  /** epoch ms — used only as the final, deterministic tie-break. */
  createdAtMs: number;
  holdingSelections: PlannerHoldingSelectionInput[];
  useEstimatedFxForForecast: boolean;
  /** 1 unit of boardCurrency = this many units of the goal's currency. Only set when useEstimatedFxForForecast is true and currencies differ. */
  estimatedForecastFxRate?: number;
}

export interface PlannerMonthlyCapacityInput {
  yearMonth: string;
  /** MonthlyForecast.planned.projectedRemaining for that month, in boardCurrency. Can be negative. */
  projectedRemaining: number;
}

export interface PlannerInput {
  boardCurrency: string;
  currentYearMonth: string;
  /** Cap on how many months ahead the planner will ever project (e.g. 60). */
  horizonMonths: number;
  goals: PlannerGoalInput[];
  /** holdingId -> current snapshot. A goal referencing a holdingId missing here is treated as "holding no longer available". */
  holdings: Record<string, PlannerHoldingSnapshot>;
  /** Ascending, starting at currentYearMonth, length === horizonMonths. */
  monthlyCapacity: PlannerMonthlyCapacityInput[];
}

export interface PlannerHoldingContributionResult {
  holdingId: string;
  currency: string;
  fullValue: number;
  computable: boolean;
  isEstimated: boolean;
  /** Full value converted to the goal's currency — used for individual viability. Null when not computable. */
  valueInGoalCurrencyIndividual: number | null;
  /** This goal's share after the priority waterfall against other active goals selecting the same holding. Null for non-active goals or when not computable. */
  valueInGoalCurrencyJoint: number | null;
  /** Other ACTIVE goals that also selected this holding. */
  sharedWithGoalIds: string[];
}

export type GoalPaceStatus =
  | 'undefined_pace'
  | 'on_track'
  | 'behind'
  | 'completed'
  | 'out_of_horizon'
  | 'currency_not_computable';

export interface PlannerGoalResult {
  goalId: string;
  status: GoalStatus;
  currentComputableValueIndividual: number;
  currentComputableValueJoint: number;
  remainingAmountIndividual: number;
  remainingAmountJoint: number;
  monthsAvailable: number | null;
  withinHorizon: boolean;
  requiredMonthlyContributionIndividual: number | null;
  requiredMonthlyContributionJoint: number | null;
  forecastCapacityComputable: boolean;
  /** Average non-negative projectedRemaining across this goal's evaluation window, converted to the goal currency. */
  averageMonthlyCapacity: number | null;
  viableIndividual: boolean | null;
  viableJoint: boolean | null;
  estimatedCompletionYearMonthIndividual: string | null;
  estimatedCompletionYearMonthJoint: string | null;
  tightestYearMonthIndividual: string | null;
  tightestYearMonthJoint: string | null;
  deficitIndividual: number | null;
  deficitJoint: number | null;
  negativeCapacityYearMonths: string[];
  holdingContributions: PlannerHoldingContributionResult[];
  paceStatusIndividual: GoalPaceStatus;
  paceStatusJoint: GoalPaceStatus;
}

export interface PlannerResult {
  currentYearMonth: string;
  horizonMonths: number;
  goals: PlannerGoalResult[];
}

interface WaterfallGoal {
  id: string;
  target: number;
  startValue: number;
  monthlyNeed: number | null;
  /** Dated goals may save ahead or catch up; contribution-based goals keep their chosen monthly cap. */
  allowFlexibleContributions: boolean;
  /** 1 unit of boardCurrency = this many units of the goal's currency. */
  boardToGoalFxRate: number | null;
  capacityComputable: boolean;
}

interface WaterfallOutcome {
  accumulatedByMonth: number[];
  completedAtMonthIndex: number | null;
}

/**
 * Deterministic, side-effect-free planner: given fully-resolved snapshots
 * (holding balances, per-goal FX rates already fetched, forecast capacity
 * already computed), it never performs I/O and always returns the same
 * output for the same input. All async resolution (Mongo reads, FxService,
 * ForecastService) happens in GoalsService before calling evaluate().
 */
@Injectable()
export class GoalsPlannerService {
  evaluate(input: PlannerInput): PlannerResult {
    const orderedActiveGoals = input.goals
      .filter((goal) => goal.status === GoalStatus.ACTIVE)
      .sort(compareGoalsByPriority);

    const holdingClaimants = new Map<string, string[]>();
    for (const goal of orderedActiveGoals) {
      for (const selection of goal.holdingSelections) {
        const claimants = holdingClaimants.get(selection.holdingId) ?? [];
        claimants.push(goal.id);
        holdingClaimants.set(selection.holdingId, claimants);
      }
    }

    const jointHoldingDraws = this.waterfallHoldingValues(
      orderedActiveGoals,
      input.holdings,
    );

    const capacitySeries = this.buildCapacitySeries(input);

    const goalResults = input.goals.map((goal) =>
      this.evaluateGoal(
        goal,
        input,
        holdingClaimants,
        jointHoldingDraws,
        capacitySeries,
        orderedActiveGoals,
      ),
    );

    return {
      currentYearMonth: input.currentYearMonth,
      horizonMonths: input.horizonMonths,
      goals: goalResults,
    };
  }

  /**
   * Deterministic conflict rule for a holding shared by several active
   * goals: process claimants in priority order (priority asc, then nearest
   * targetDate, then oldest createdAt). Each goal draws from the holding's
   * remaining pool up to min(pool left, its own targetAmount) — a
   * conservative per-holding cap, since a goal can never usefully need more
   * from a single holding than its own target. The pool decrements as each
   * goal draws, so the same value is never counted twice.
   */
  private waterfallHoldingValues(
    orderedActiveGoals: PlannerGoalInput[],
    holdings: Record<string, PlannerHoldingSnapshot>,
  ): Map<string, number> {
    const draws = new Map<string, number>(); // `${goalId}:${holdingId}` -> value in goal currency
    const poolByHolding = new Map<string, number>();
    for (const [holdingId, snapshot] of Object.entries(holdings)) {
      poolByHolding.set(holdingId, snapshot.currentBalance);
    }

    for (const goal of orderedActiveGoals) {
      for (const selection of goal.holdingSelections) {
        const snapshot = holdings[selection.holdingId];
        const key = `${goal.id}:${selection.holdingId}`;
        if (!snapshot) {
          draws.set(key, 0);
          continue;
        }
        const rate = resolveHoldingRate(
          snapshot.currency,
          goal.currency,
          selection,
        );
        const poolRemaining = poolByHolding.get(selection.holdingId) ?? 0;
        if (rate === null || poolRemaining <= 0) {
          draws.set(key, 0);
          continue;
        }
        const capInHoldingCurrency = rate > 0 ? goal.targetAmount / rate : 0;
        const drawInHoldingCurrency = Math.min(
          poolRemaining,
          capInHoldingCurrency,
        );
        poolByHolding.set(
          selection.holdingId,
          poolRemaining - drawInHoldingCurrency,
        );
        draws.set(key, drawInHoldingCurrency * rate);
      }
    }
    return draws;
  }

  private buildCapacitySeries(input: PlannerInput) {
    return input.monthlyCapacity.map((month) => ({
      yearMonth: month.yearMonth,
      boardCapacity: Math.max(0, month.projectedRemaining),
      isNegative: month.projectedRemaining < 0,
    }));
  }

  private evaluateGoal(
    goal: PlannerGoalInput,
    input: PlannerInput,
    holdingClaimants: Map<string, string[]>,
    jointHoldingDraws: Map<string, number>,
    capacitySeries: Array<{
      yearMonth: string;
      boardCapacity: number;
      isNegative: boolean;
    }>,
    orderedActiveGoals: PlannerGoalInput[],
  ): PlannerGoalResult {
    const isActive = goal.status === GoalStatus.ACTIVE;
    const holdingContributions: PlannerHoldingContributionResult[] = [];
    let currentComputableValueIndividual = 0;
    let currentComputableValueJoint = 0;

    for (const selection of goal.holdingSelections) {
      const snapshot = input.holdings[selection.holdingId];
      const rate = snapshot
        ? resolveHoldingRate(snapshot.currency, goal.currency, selection)
        : null;
      const computable = !!snapshot && rate !== null;
      const valueInGoalCurrencyIndividual =
        computable && snapshot ? snapshot.currentBalance * rate : null;
      if (computable && valueInGoalCurrencyIndividual !== null) {
        currentComputableValueIndividual += valueInGoalCurrencyIndividual;
      }

      const valueInGoalCurrencyJoint = isActive
        ? (jointHoldingDraws.get(`${goal.id}:${selection.holdingId}`) ?? 0)
        : null;
      if (isActive && valueInGoalCurrencyJoint !== null) {
        currentComputableValueJoint += valueInGoalCurrencyJoint;
      }

      holdingContributions.push({
        holdingId: selection.holdingId,
        currency: snapshot?.currency ?? '',
        fullValue: snapshot?.currentBalance ?? 0,
        computable,
        isEstimated:
          computable && !!snapshot && snapshot.currency !== goal.currency,
        valueInGoalCurrencyIndividual,
        valueInGoalCurrencyJoint,
        sharedWithGoalIds: (
          holdingClaimants.get(selection.holdingId) ?? []
        ).filter((id) => id !== goal.id),
      });
    }

    const remainingAmountIndividual = Math.max(
      0,
      goal.targetAmount - currentComputableValueIndividual,
    );
    const remainingAmountJoint = Math.max(
      0,
      goal.targetAmount - currentComputableValueJoint,
    );

    const monthsAvailable =
      goal.targetYearMonth !== null
        ? monthsBetweenYearMonths(input.currentYearMonth, goal.targetYearMonth)
        : null;
    const withinHorizon =
      monthsAvailable === null ? true : monthsAvailable <= input.horizonMonths;
    const effectiveMonths =
      monthsAvailable === null ? null : Math.max(1, monthsAvailable);

    const requiredMonthlyContributionIndividual =
      effectiveMonths === null
        ? null
        : remainingAmountIndividual / effectiveMonths;
    const requiredMonthlyContributionJoint =
      effectiveMonths === null ? null : remainingAmountJoint / effectiveMonths;

    const forecastCapacityComputable =
      goal.currency === input.boardCurrency ||
      (goal.useEstimatedFxForForecast &&
        goal.estimatedForecastFxRate !== undefined);
    const capacityWindowMonths =
      monthsAvailable === null
        ? input.horizonMonths
        : Math.min(Math.max(monthsAvailable, 1), input.horizonMonths);
    const boardToGoalFxRate =
      goal.currency === input.boardCurrency
        ? 1
        : (goal.estimatedForecastFxRate ?? null);
    const averageMonthlyCapacity =
      forecastCapacityComputable && boardToGoalFxRate !== null
        ? (capacitySeries
            .slice(0, capacityWindowMonths)
            .reduce((sum, month) => sum + month.boardCapacity, 0) /
            capacityWindowMonths) *
          boardToGoalFxRate
        : null;

    // Goals marked completed/paused/archived by the user are reported as-is
    // without running a forward simulation.
    if (goal.status === GoalStatus.COMPLETED) {
      return {
        goalId: goal.id,
        status: goal.status,
        currentComputableValueIndividual,
        currentComputableValueJoint,
        remainingAmountIndividual,
        remainingAmountJoint,
        monthsAvailable,
        withinHorizon,
        requiredMonthlyContributionIndividual,
        requiredMonthlyContributionJoint,
        forecastCapacityComputable,
        averageMonthlyCapacity,
        viableIndividual: true,
        viableJoint: true,
        estimatedCompletionYearMonthIndividual: null,
        estimatedCompletionYearMonthJoint: null,
        tightestYearMonthIndividual: null,
        tightestYearMonthJoint: null,
        deficitIndividual: 0,
        deficitJoint: 0,
        negativeCapacityYearMonths: [],
        holdingContributions,
        paceStatusIndividual: 'completed',
        paceStatusJoint: 'completed',
      };
    }

    const negativeCapacityYearMonths = capacitySeries
      .filter((month) => month.isNegative)
      .map((month) => month.yearMonth)
      .filter((yearMonth) =>
        monthsAvailable === null
          ? true
          : monthsBetweenYearMonths(input.currentYearMonth, yearMonth) <=
            Math.max(effectiveMonths ?? input.horizonMonths, 1),
      );

    const monthlyNeedIndividual = goal.targetYearMonth
      ? requiredMonthlyContributionIndividual
      : goal.desiredMonthlyContribution;
    const monthlyNeedJoint = goal.targetYearMonth
      ? requiredMonthlyContributionJoint
      : goal.desiredMonthlyContribution;

    let individualSim: WaterfallOutcome | null = null;
    let jointSim: WaterfallOutcome | null = null;

    if (forecastCapacityComputable && monthlyNeedIndividual !== null) {
      const outcomes = this.simulateWaterfall(
        [
          {
            id: goal.id,
            target: goal.targetAmount,
            startValue: currentComputableValueIndividual,
            monthlyNeed: monthlyNeedIndividual,
            allowFlexibleContributions: goal.targetYearMonth !== null,
            boardToGoalFxRate:
              goal.currency === input.boardCurrency
                ? 1
                : (goal.estimatedForecastFxRate ?? null),
            capacityComputable: true,
          },
        ],
        capacitySeries.map((month) => month.boardCapacity),
        input.horizonMonths,
      );
      individualSim = outcomes.get(goal.id) ?? null;
    }

    if (isActive && forecastCapacityComputable && monthlyNeedJoint !== null) {
      const waterfallGoals: WaterfallGoal[] = orderedActiveGoals.map((g) => {
        const gCapacityComputable =
          g.currency === input.boardCurrency ||
          (g.useEstimatedFxForForecast &&
            g.estimatedForecastFxRate !== undefined);
        const gStartValue =
          g.id === goal.id
            ? currentComputableValueJoint
            : this.jointStartValueFor(g, holdingClaimants, jointHoldingDraws);
        const gRemaining = Math.max(0, g.targetAmount - gStartValue);
        const gEffectiveMonths = g.targetYearMonth
          ? Math.max(
              1,
              monthsBetweenYearMonths(
                input.currentYearMonth,
                g.targetYearMonth,
              ),
            )
          : null;
        const gMonthlyNeed = g.targetYearMonth
          ? gEffectiveMonths !== null
            ? gRemaining / gEffectiveMonths
            : null
          : g.desiredMonthlyContribution;
        return {
          id: g.id,
          target: g.targetAmount,
          startValue: gStartValue,
          monthlyNeed: gMonthlyNeed,
          allowFlexibleContributions: g.targetYearMonth !== null,
          boardToGoalFxRate:
            g.currency === input.boardCurrency
              ? 1
              : (g.estimatedForecastFxRate ?? null),
          capacityComputable: gCapacityComputable,
        };
      });
      const outcomes = this.simulateWaterfall(
        waterfallGoals,
        capacitySeries.map((month) => month.boardCapacity),
        input.horizonMonths,
      );
      jointSim = outcomes.get(goal.id) ?? null;
    }

    const individualProjection = this.projectFromSimulation(
      individualSim,
      goal.targetAmount,
      remainingAmountIndividual,
      input.currentYearMonth,
      monthsAvailable,
      input.horizonMonths,
    );
    const jointProjection = isActive
      ? this.projectFromSimulation(
          jointSim,
          goal.targetAmount,
          remainingAmountJoint,
          input.currentYearMonth,
          monthsAvailable,
          input.horizonMonths,
        )
      : null;

    const paceStatusIndividual = this.resolvePaceStatus(
      remainingAmountIndividual,
      forecastCapacityComputable,
      monthlyNeedIndividual,
      individualProjection,
      withinHorizon,
    );
    const paceStatusJoint = isActive
      ? this.resolvePaceStatus(
          remainingAmountJoint,
          forecastCapacityComputable,
          monthlyNeedJoint,
          jointProjection,
          withinHorizon,
        )
      : 'undefined_pace';

    return {
      goalId: goal.id,
      status: goal.status,
      currentComputableValueIndividual,
      currentComputableValueJoint,
      remainingAmountIndividual,
      remainingAmountJoint,
      monthsAvailable,
      withinHorizon,
      requiredMonthlyContributionIndividual,
      requiredMonthlyContributionJoint,
      forecastCapacityComputable,
      averageMonthlyCapacity,
      viableIndividual: individualProjection?.viable ?? null,
      viableJoint: isActive ? (jointProjection?.viable ?? null) : null,
      estimatedCompletionYearMonthIndividual:
        individualProjection?.estimatedCompletionYearMonth ?? null,
      estimatedCompletionYearMonthJoint:
        jointProjection?.estimatedCompletionYearMonth ?? null,
      tightestYearMonthIndividual:
        individualProjection?.tightestYearMonth ?? null,
      tightestYearMonthJoint: jointProjection?.tightestYearMonth ?? null,
      deficitIndividual: individualProjection?.deficit ?? null,
      deficitJoint: jointProjection?.deficit ?? null,
      negativeCapacityYearMonths,
      holdingContributions,
      paceStatusIndividual,
      paceStatusJoint,
    };
  }

  /** currentComputableValueJoint for a goal other than the one currently being reported, recomputed the same way. */
  private jointStartValueFor(
    goal: PlannerGoalInput,
    _holdingClaimants: Map<string, string[]>,
    jointHoldingDraws: Map<string, number>,
  ): number {
    return goal.holdingSelections.reduce(
      (sum, selection) =>
        sum + (jointHoldingDraws.get(`${goal.id}:${selection.holdingId}`) ?? 0),
      0,
    );
  }

  /**
   * Runs a single month-by-month waterfall across the given goals (already
   * in priority order) against one shared monthly capacity pool. Each goal
   * draws from the capacity left in the pool that month — converted to/from
   * boardCurrency via boardToGoalFxRate — until it reaches its target or the
   * horizon ends. Goals with a target date may use
   * surplus capacity to save ahead or recover a weak month; goals configured
   * with a desired monthly contribution keep that amount as a hard monthly
   * cap. Used both for the joint analysis (all active goals sharing one pool)
   * and, called once per goal with a single-element list, for the individual
   * analysis (a goal alone against the full pool).
   */
  private simulateWaterfall(
    goals: WaterfallGoal[],
    monthlyCapacityBoardCurrency: number[],
    horizonMonths: number,
  ): Map<string, WaterfallOutcome> {
    const accumulated = new Map<string, number>();
    const accumulatedByMonth = new Map<string, number[]>();
    const completedAt = new Map<string, number | null>();
    for (const goal of goals) {
      accumulated.set(goal.id, goal.startValue);
      accumulatedByMonth.set(goal.id, []);
      completedAt.set(goal.id, goal.startValue >= goal.target ? -1 : null);
    }

    for (let monthIndex = 0; monthIndex < horizonMonths; monthIndex++) {
      let poolRemaining = monthlyCapacityBoardCurrency[monthIndex] ?? 0;
      for (const goal of goals) {
        const already = accumulated.get(goal.id) ?? 0;
        const isDone = already >= goal.target;
        if (
          !isDone &&
          goal.capacityComputable &&
          goal.monthlyNeed !== null &&
          goal.boardToGoalFxRate !== null &&
          goal.boardToGoalFxRate > 0
        ) {
          const contributionLimit = goal.allowFlexibleContributions
            ? goal.target - already
            : goal.monthlyNeed;
          const needInBoardCurrency =
            contributionLimit / goal.boardToGoalFxRate;
          const takeInBoardCurrency = Math.min(
            needInBoardCurrency,
            poolRemaining,
          );
          poolRemaining -= takeInBoardCurrency;
          const takeInGoalCurrency =
            takeInBoardCurrency * goal.boardToGoalFxRate;
          const next = already + takeInGoalCurrency;
          accumulated.set(goal.id, next);
          if (next >= goal.target && completedAt.get(goal.id) === null) {
            completedAt.set(goal.id, monthIndex);
          }
        }
        accumulatedByMonth.get(goal.id)!.push(accumulated.get(goal.id) ?? 0);
      }
    }

    const outcomes = new Map<string, WaterfallOutcome>();
    for (const goal of goals) {
      outcomes.set(goal.id, {
        accumulatedByMonth: accumulatedByMonth.get(goal.id) ?? [],
        completedAtMonthIndex: completedAt.get(goal.id) ?? null,
      });
    }
    return outcomes;
  }

  private projectFromSimulation(
    sim: WaterfallOutcome | null,
    target: number,
    remainingAmount: number,
    currentYearMonth: string,
    monthsAvailable: number | null,
    horizonMonths: number,
  ): {
    viable: boolean;
    estimatedCompletionYearMonth: string | null;
    tightestYearMonth: string | null;
    deficit: number;
  } | null {
    if (remainingAmount <= 0) {
      return {
        viable: true,
        estimatedCompletionYearMonth: currentYearMonth,
        tightestYearMonth: null,
        deficit: 0,
      };
    }
    if (!sim) return null;

    const completionYearMonth =
      sim.completedAtMonthIndex === null
        ? null
        : sim.completedAtMonthIndex === -1
          ? currentYearMonth
          : shiftYearMonth(currentYearMonth, sim.completedAtMonthIndex + 1);

    const viable =
      monthsAvailable === null
        ? completionYearMonth !== null
        : completionYearMonth !== null &&
          monthsBetweenYearMonths(currentYearMonth, completionYearMonth) <=
            monthsAvailable;

    const evaluationWindow =
      monthsAvailable === null
        ? horizonMonths
        : Math.min(Math.max(monthsAvailable, 1), horizonMonths);
    const accumulatedAtWindowEnd =
      sim.accumulatedByMonth[evaluationWindow - 1] ??
      sim.accumulatedByMonth[sim.accumulatedByMonth.length - 1] ??
      0;
    const deficit = viable ? 0 : Math.max(0, target - accumulatedAtWindowEnd);

    let tightestYearMonth: string | null = null;
    if (!viable) {
      let lowestBuffer = Number.POSITIVE_INFINITY;
      sim.accumulatedByMonth.forEach((value, index) => {
        if (index >= evaluationWindow) return;
        const expectedAtThisPace = target * ((index + 1) / evaluationWindow);
        const buffer = value - expectedAtThisPace;
        if (buffer < lowestBuffer) {
          lowestBuffer = buffer;
          tightestYearMonth = shiftYearMonth(currentYearMonth, index + 1);
        }
      });
    }

    return {
      viable,
      estimatedCompletionYearMonth: completionYearMonth,
      tightestYearMonth,
      deficit,
    };
  }

  private resolvePaceStatus(
    remainingAmount: number,
    forecastCapacityComputable: boolean,
    monthlyNeed: number | null,
    projection: { viable: boolean } | null,
    withinHorizon: boolean,
  ): GoalPaceStatus {
    if (remainingAmount <= 0) return 'completed';
    if (!forecastCapacityComputable) return 'currency_not_computable';
    if (monthlyNeed === null) return 'undefined_pace';
    if (!withinHorizon) return 'out_of_horizon';
    if (!projection) return 'undefined_pace';
    return projection.viable ? 'on_track' : 'behind';
  }
}

/**
 * Deterministic ordering for the priority waterfall: priority ascending
 * (1 = highest), then nearest targetDate first (goals without a date sort
 * last), then oldest createdAt as the final tie-break.
 */
export function compareGoalsByPriority(
  a: PlannerGoalInput,
  b: PlannerGoalInput,
): number {
  if (a.priority !== b.priority) return a.priority - b.priority;
  const aDate = a.targetYearMonth ?? '9999-12';
  const bDate = b.targetYearMonth ?? '9999-12';
  if (aDate !== bDate) return aDate < bDate ? -1 : 1;
  return a.createdAtMs - b.createdAtMs;
}

function resolveHoldingRate(
  holdingCurrency: string,
  goalCurrency: string,
  selection: PlannerHoldingSelectionInput,
): number | null {
  if (holdingCurrency === goalCurrency) return 1;
  if (
    selection.useEstimatedFx &&
    selection.estimatedFxRateToGoalCurrency !== undefined
  ) {
    return selection.estimatedFxRateToGoalCurrency;
  }
  return null;
}
