import {
  GoalsPlannerService,
  PlannerGoalInput,
  PlannerInput,
  compareGoalsByPriority,
} from './goals-planner.service';
import { GoalStatus } from './goals.schemas';

function makeGoal(overrides: Partial<PlannerGoalInput> = {}): PlannerGoalInput {
  return {
    id: 'goal-1',
    targetAmount: 10000,
    currency: 'ARS',
    targetYearMonth: null,
    desiredMonthlyContribution: null,
    priority: 5,
    status: GoalStatus.ACTIVE,
    createdAtMs: 0,
    holdingSelections: [],
    useEstimatedFxForForecast: false,
    ...overrides,
  };
}

function makeCapacity(
  currentYearMonth: string,
  horizonMonths: number,
  amountPerMonth: number | number[],
) {
  const months: { yearMonth: string; projectedRemaining: number }[] = [];
  const [year, month] = currentYearMonth.split('-').map(Number);
  for (let i = 0; i < horizonMonths; i++) {
    const d = new Date(year, month - 1 + i, 1);
    const yearMonth = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const amount = Array.isArray(amountPerMonth)
      ? (amountPerMonth[i] ?? amountPerMonth[amountPerMonth.length - 1])
      : amountPerMonth;
    months.push({ yearMonth, projectedRemaining: amount });
  }
  return months;
}

function baseInput(overrides: Partial<PlannerInput> = {}): PlannerInput {
  const currentYearMonth = '2026-09';
  const horizonMonths = 60;
  return {
    boardCurrency: 'ARS',
    currentYearMonth,
    horizonMonths,
    goals: [],
    holdings: {},
    monthlyCapacity: makeCapacity(currentYearMonth, horizonMonths, 1000),
    ...overrides,
  };
}

describe('GoalsPlannerService', () => {
  let planner: GoalsPlannerService;

  beforeEach(() => {
    planner = new GoalsPlannerService();
  });

  it('reports zero computable capital for a goal with no holdings selected', () => {
    const result = planner.evaluate(
      baseInput({ goals: [makeGoal({ targetAmount: 5000 })] }),
    );
    const goal = result.goals[0];
    expect(goal.currentComputableValueIndividual).toBe(0);
    expect(goal.remainingAmountIndividual).toBe(5000);
  });

  it('sums a single selected holding fully into computable capital', () => {
    const result = planner.evaluate(
      baseInput({
        goals: [
          makeGoal({
            targetAmount: 5000,
            holdingSelections: [{ holdingId: 'h1', useEstimatedFx: false }],
          }),
        ],
        holdings: { h1: { currency: 'ARS', currentBalance: 3000 } },
      }),
    );
    expect(result.goals[0].currentComputableValueIndividual).toBe(3000);
    expect(result.goals[0].remainingAmountIndividual).toBe(2000);
  });

  it('sums several selected holdings (investment + checking account) without double counting', () => {
    const result = planner.evaluate(
      baseInput({
        goals: [
          makeGoal({
            targetAmount: 5000,
            holdingSelections: [
              { holdingId: 'checking', useEstimatedFx: false },
              { holdingId: 'investment', useEstimatedFx: false },
            ],
          }),
        ],
        holdings: {
          checking: { currency: 'ARS', currentBalance: 1000 },
          investment: { currency: 'ARS', currentBalance: 2500 },
        },
      }),
    );
    expect(result.goals[0].currentComputableValueIndividual).toBe(3500);
  });

  it('excludes a holding that was not selected for the goal', () => {
    const result = planner.evaluate(
      baseInput({
        goals: [
          makeGoal({
            targetAmount: 5000,
            holdingSelections: [
              { holdingId: 'included', useEstimatedFx: false },
            ],
          }),
        ],
        holdings: {
          included: { currency: 'ARS', currentBalance: 1000 },
          excluded: { currency: 'ARS', currentBalance: 9999 },
        },
      }),
    );
    expect(result.goals[0].currentComputableValueIndividual).toBe(1000);
  });

  it('marks a mismatched-currency holding as not computable without FX opt-in', () => {
    const result = planner.evaluate(
      baseInput({
        goals: [
          makeGoal({
            currency: 'ARS',
            holdingSelections: [{ holdingId: 'usd', useEstimatedFx: false }],
          }),
        ],
        holdings: { usd: { currency: 'USD', currentBalance: 100 } },
      }),
    );
    const contribution = result.goals[0].holdingContributions[0];
    expect(contribution.computable).toBe(false);
    expect(contribution.valueInGoalCurrencyIndividual).toBeNull();
    expect(result.goals[0].currentComputableValueIndividual).toBe(0);
  });

  it('converts a mismatched-currency holding when FX opt-in is enabled', () => {
    const result = planner.evaluate(
      baseInput({
        goals: [
          makeGoal({
            currency: 'ARS',
            holdingSelections: [
              {
                holdingId: 'usd',
                useEstimatedFx: true,
                estimatedFxRateToGoalCurrency: 1000,
              },
            ],
          }),
        ],
        holdings: { usd: { currency: 'USD', currentBalance: 100 } },
      }),
    );
    const contribution = result.goals[0].holdingContributions[0];
    expect(contribution.computable).toBe(true);
    expect(contribution.isEstimated).toBe(true);
    expect(result.goals[0].currentComputableValueIndividual).toBe(100000);
  });

  it('is viable when capacity comfortably covers the required monthly contribution', () => {
    const currentYearMonth = '2026-09';
    const result = planner.evaluate(
      baseInput({
        currentYearMonth,
        goals: [
          makeGoal({
            targetAmount: 6000,
            targetYearMonth: '2026-12',
          }),
        ],
        monthlyCapacity: makeCapacity(currentYearMonth, 60, 5000),
      }),
    );
    expect(result.goals[0].viableIndividual).toBe(true);
    expect(result.goals[0].averageMonthlyCapacity).toBe(5000);
    expect(result.goals[0].deficitIndividual).toBe(0);
  });

  it('reports average monthly capacity in the goal currency for comparison with the required contribution', () => {
    const currentYearMonth = '2026-09';
    const horizonMonths = 36;
    const result = planner.evaluate(
      baseInput({
        currentYearMonth,
        horizonMonths: 60,
        goals: [
          makeGoal({
            targetAmount: 40000,
            currency: 'USD',
            targetYearMonth: '2029-09',
            holdingSelections: [{ holdingId: 'usd', useEstimatedFx: false }],
            useEstimatedFxForForecast: true,
            estimatedForecastFxRate: 1 / 1450,
          }),
        ],
        holdings: { usd: { currency: 'USD', currentBalance: 14427.03 } },
        monthlyCapacity: makeCapacity(
          currentYearMonth,
          horizonMonths,
          3_500_000,
        ),
      }),
    );

    const goal = result.goals[0];
    expect(goal.averageMonthlyCapacity).toBeCloseTo(2413.79, 2);
    expect(goal.requiredMonthlyContributionJoint).toBeCloseTo(710.36, 2);
    expect(goal.viableJoint).toBe(true);
  });

  it('is not viable when capacity falls short of the required monthly contribution', () => {
    const currentYearMonth = '2026-09';
    const result = planner.evaluate(
      baseInput({
        currentYearMonth,
        goals: [
          makeGoal({
            targetAmount: 6000,
            targetYearMonth: '2026-12',
          }),
        ],
        monthlyCapacity: makeCapacity(currentYearMonth, 60, 100),
      }),
    );
    expect(result.goals[0].viableIndividual).toBe(false);
    expect(result.goals[0].deficitIndividual).toBeGreaterThan(0);
  });

  it('keeps two independent active goals jointly viable when capacity covers both', () => {
    const currentYearMonth = '2026-09';
    const result = planner.evaluate(
      baseInput({
        currentYearMonth,
        goals: [
          makeGoal({
            id: 'g1',
            targetAmount: 3000,
            targetYearMonth: '2026-12',
            priority: 1,
          }),
          makeGoal({
            id: 'g2',
            targetAmount: 3000,
            targetYearMonth: '2026-12',
            priority: 2,
          }),
        ],
        monthlyCapacity: makeCapacity(currentYearMonth, 60, 5000),
      }),
    );
    expect(result.goals.find((g) => g.goalId === 'g1')!.viableJoint).toBe(true);
    expect(result.goals.find((g) => g.goalId === 'g2')!.viableJoint).toBe(true);
  });

  it('splits a holding shared by two active goals without double counting, favoring higher priority', () => {
    const result = planner.evaluate(
      baseInput({
        goals: [
          makeGoal({
            id: 'high-priority',
            priority: 1,
            targetAmount: 3000,
            holdingSelections: [{ holdingId: 'shared', useEstimatedFx: false }],
          }),
          makeGoal({
            id: 'low-priority',
            priority: 2,
            targetAmount: 3000,
            holdingSelections: [{ holdingId: 'shared', useEstimatedFx: false }],
          }),
        ],
        holdings: { shared: { currency: 'ARS', currentBalance: 4000 } },
      }),
    );
    const high = result.goals.find((g) => g.goalId === 'high-priority')!;
    const low = result.goals.find((g) => g.goalId === 'low-priority')!;

    expect(high.currentComputableValueJoint).toBe(3000);
    expect(low.currentComputableValueJoint).toBe(1000);
    expect(
      high.currentComputableValueJoint + low.currentComputableValueJoint,
    ).toBe(4000);

    const highContribution = high.holdingContributions[0];
    expect(highContribution.sharedWithGoalIds).toEqual(['low-priority']);
    // Individual view never splits — each goal sees the holding's full value on its own.
    expect(highContribution.valueInGoalCurrencyIndividual).toBe(4000);
  });

  it('orders by nearest target date when priorities tie', () => {
    const goals = [
      makeGoal({ id: 'later', priority: 3, targetYearMonth: '2027-01' }),
      makeGoal({ id: 'sooner', priority: 3, targetYearMonth: '2026-10' }),
    ].sort(compareGoalsByPriority);
    expect(goals.map((g) => g.id)).toEqual(['sooner', 'later']);
  });

  it('orders by priority ascending (1 = highest) regardless of dates', () => {
    const goals = [
      makeGoal({ id: 'low', priority: 5, targetYearMonth: '2026-10' }),
      makeGoal({ id: 'high', priority: 1, targetYearMonth: '2028-01' }),
    ].sort(compareGoalsByPriority);
    expect(goals.map((g) => g.id)).toEqual(['high', 'low']);
  });

  it('breaks a full tie (same priority and target date) by createdAt, oldest first', () => {
    const goals = [
      makeGoal({
        id: 'newer',
        priority: 2,
        targetYearMonth: '2026-12',
        createdAtMs: 200,
      }),
      makeGoal({
        id: 'older',
        priority: 2,
        targetYearMonth: '2026-12',
        createdAtMs: 100,
      }),
    ].sort(compareGoalsByPriority);
    expect(goals.map((g) => g.id)).toEqual(['older', 'newer']);
  });

  it('excludes a paused goal from the joint analysis but still reports its individual figures', () => {
    const result = planner.evaluate(
      baseInput({
        goals: [
          makeGoal({
            status: GoalStatus.PAUSED,
            targetAmount: 1000,
            holdingSelections: [{ holdingId: 'h1', useEstimatedFx: false }],
          }),
        ],
        holdings: { h1: { currency: 'ARS', currentBalance: 400 } },
      }),
    );
    const goal = result.goals[0];
    expect(goal.currentComputableValueIndividual).toBe(400);
    expect(goal.currentComputableValueJoint).toBe(0);
    expect(goal.viableJoint).toBeNull();
  });

  it('reports a completed goal as fully viable without running a simulation', () => {
    const result = planner.evaluate(
      baseInput({
        goals: [makeGoal({ status: GoalStatus.COMPLETED, targetAmount: 1000 })],
      }),
    );
    const goal = result.goals[0];
    expect(goal.viableIndividual).toBe(true);
    expect(goal.viableJoint).toBe(true);
    expect(goal.deficitIndividual).toBe(0);
  });

  it('never allocates negative capacity and lets dated goals recover weak months with later surplus', () => {
    const currentYearMonth = '2026-09';
    const result = planner.evaluate(
      baseInput({
        currentYearMonth,
        // Target is 4 months out. The first 2 months cannot fund the goal,
        // but the third has enough surplus to recover the delay.
        goals: [makeGoal({ targetAmount: 1000, targetYearMonth: '2027-01' })],
        monthlyCapacity: makeCapacity(
          currentYearMonth,
          60,
          [-500, -500, 5000, 5000, 5000],
        ),
      }),
    );
    const goal = result.goals[0];
    expect(goal.negativeCapacityYearMonths).toEqual(['2026-09', '2026-10']);
    expect(goal.viableIndividual).toBe(true);
    expect(goal.deficitIndividual).toBe(0);
    expect(goal.estimatedCompletionYearMonthIndividual).toBe('2026-12');
  });

  it('uses above-average months to compensate a dated goal month below the required contribution', () => {
    const currentYearMonth = '2026-09';
    const result = planner.evaluate(
      baseInput({
        currentYearMonth,
        goals: [makeGoal({ targetAmount: 1200, targetYearMonth: '2027-09' })],
        monthlyCapacity: makeCapacity(currentYearMonth, 60, [
          0,
          ...Array<number>(11).fill(120),
        ]),
      }),
    );

    const goal = result.goals[0];
    expect(goal.requiredMonthlyContributionIndividual).toBe(100);
    expect(goal.averageMonthlyCapacity).toBe(110);
    expect(goal.viableIndividual).toBe(true);
    expect(goal.estimatedCompletionYearMonthIndividual).toBe('2027-08');
  });

  it('a goal without a target date just absorbs one negative month, staying viable within the horizon', () => {
    const currentYearMonth = '2026-09';
    const result = planner.evaluate(
      baseInput({
        currentYearMonth,
        goals: [
          makeGoal({ targetAmount: 500, desiredMonthlyContribution: 200 }),
        ],
        monthlyCapacity: makeCapacity(
          currentYearMonth,
          60,
          [-500, 5000, 5000, 5000, 5000, 5000],
        ),
      }),
    );
    const goal = result.goals[0];
    expect(goal.negativeCapacityYearMonths).toEqual(['2026-09']);
    expect(goal.viableIndividual).toBe(true);
    // Month 0 is blocked (0 contributed); 200/month from month 1 onward
    // reaches 500 at month index 3 (2026-09 + 4 => 2027-01).
    expect(goal.estimatedCompletionYearMonthIndividual).toBe('2027-01');
  });

  it('handles a target date inside the current month without crashing', () => {
    const currentYearMonth = '2026-09';
    const result = planner.evaluate(
      baseInput({
        currentYearMonth,
        goals: [
          makeGoal({
            targetAmount: 1000,
            targetYearMonth: currentYearMonth,
          }),
        ],
      }),
    );
    const goal = result.goals[0];
    expect(goal.monthsAvailable).toBe(0);
    expect(goal.requiredMonthlyContributionIndividual).toBe(1000);
  });

  it('computes months available correctly across a year boundary', () => {
    const currentYearMonth = '2026-11';
    const result = planner.evaluate(
      baseInput({
        currentYearMonth,
        goals: [makeGoal({ targetAmount: 300, targetYearMonth: '2027-02' })],
        monthlyCapacity: makeCapacity(currentYearMonth, 60, 1000),
      }),
    );
    expect(result.goals[0].monthsAvailable).toBe(3);
  });

  it('flags a goal whose target date falls beyond the horizon', () => {
    const currentYearMonth = '2026-09';
    const result = planner.evaluate(
      baseInput({
        currentYearMonth,
        horizonMonths: 60,
        goals: [makeGoal({ targetAmount: 1000, targetYearMonth: '2032-01' })],
        monthlyCapacity: makeCapacity(currentYearMonth, 60, 1000),
      }),
    );
    const goal = result.goals[0];
    expect(goal.withinHorizon).toBe(false);
    expect(goal.paceStatusIndividual).toBe('out_of_horizon');
  });
});
