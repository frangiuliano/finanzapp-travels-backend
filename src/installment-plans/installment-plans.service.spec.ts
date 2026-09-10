import { Types } from 'mongoose';
import { ExpenseStatus } from '../expenses/expense.schema';
import { InstallmentPlansService } from './installment-plans.service';
import { InstallmentRescheduleScope } from './dto/reschedule-installment.dto';

describe('InstallmentPlansService materialization', () => {
  it('creates one real expense for each remaining installment', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-09-10T12:00:00.000Z'));

    const boardId = new Types.ObjectId();
    const userId = new Types.ObjectId();
    const participantId = new Types.ObjectId();
    const planId = new Types.ObjectId();
    const plan = {
      _id: planId,
      tripId: boardId,
      label: 'Sillón',
      installmentAmount: 250000,
      totalInstallments: 3,
      paidInstallments: 1,
      startYearMonth: '2026-08',
      dayOfMonth: 10,
      currency: 'ARS',
      createdBy: userId,
      isActive: true,
    };
    const installmentPlanModel = {
      find: jest.fn().mockResolvedValue([plan]),
    };
    const expenseModel = {
      deleteMany: jest.fn().mockResolvedValue({ deletedCount: 0 }),
      updateOne: jest.fn().mockResolvedValue({ upsertedCount: 1 }),
      updateMany: jest.fn().mockResolvedValue({ modifiedCount: 0 }),
    };
    const participantModel = {
      findOne: jest.fn().mockResolvedValue({ _id: participantId }),
    };
    const participantsService = {
      ensureParticipantAccess: jest.fn().mockResolvedValue(undefined),
    };

    const service = new InstallmentPlansService(
      installmentPlanModel as never,
      expenseModel as never,
      participantModel as never,
      participantsService as never,
      {} as never,
      {} as never,
    );

    await service.ensureExpenseOccurrences(
      boardId.toString(),
      userId.toString(),
    );

    expect(expenseModel.updateOne).toHaveBeenCalledTimes(2);
    expect(expenseModel.updateOne).toHaveBeenNthCalledWith(
      1,
      { occurrenceKey: `installment:${planId.toString()}:2` },
      expect.objectContaining({
        $setOnInsert: expect.objectContaining({
          installmentNumber: 2,
          paymentYearMonth: '2026-09',
          status: ExpenseStatus.PAID,
        }),
      }),
      { upsert: true },
    );
    expect(expenseModel.updateOne).toHaveBeenNthCalledWith(
      2,
      { occurrenceKey: `installment:${planId.toString()}:3` },
      expect.objectContaining({
        $setOnInsert: expect.objectContaining({
          installmentNumber: 3,
          paymentYearMonth: '2026-10',
          status: ExpenseStatus.PENDING,
        }),
      }),
      { upsert: true },
    );

    jest.useRealTimers();
  });
});

describe('InstallmentPlansService.findAllByBoard', () => {
  it('adds the paidInstallments seed to the live paid count, since seeded cuotas are never materialized', async () => {
    const boardId = new Types.ObjectId();
    const userId = new Types.ObjectId().toString();
    const fullySeededPlanId = new Types.ObjectId();
    const partiallySeededPlanId = new Types.ObjectId();

    const plans = [
      {
        _id: fullySeededPlanId,
        label: 'Arredo',
        totalInstallments: 18,
        paidInstallments: 18,
      },
      {
        _id: partiallySeededPlanId,
        label: 'Sillón',
        totalInstallments: 6,
        paidInstallments: 3,
      },
    ];

    const installmentPlanModel = {
      find: jest.fn().mockReturnValue({
        sort: jest.fn().mockReturnValue({
          lean: jest.fn().mockResolvedValue(plans),
        }),
      }),
    };
    const expenseModel = {
      aggregate: jest.fn().mockResolvedValue([
        // Only the partially-seeded plan has anything materialized (cuotas
        // 4..6), and only one of those has auto-transitioned to paid.
        { _id: partiallySeededPlanId, count: 1 },
      ]),
    };
    const participantsService = {
      ensureParticipantAccess: jest.fn().mockResolvedValue(undefined),
    };

    const service = new InstallmentPlansService(
      installmentPlanModel as never,
      expenseModel as never,
      {} as never,
      participantsService as never,
      {} as never,
      {} as never,
    );

    const result = await service.findAllByBoard(boardId.toString(), userId);

    // The mocked .lean() resolves `plans` in this exact order.
    const [fullySeeded, partiallySeeded] = result;

    expect(fullySeeded.paidCount).toBe(18);
    expect(partiallySeeded.paidCount).toBe(4);
  });
});

describe('InstallmentPlansService.rescheduleInstallments', () => {
  const boardId = new Types.ObjectId();
  const userId = new Types.ObjectId();
  const planId = new Types.ObjectId();
  const paymentMethodId = new Types.ObjectId();

  const basePlan = {
    _id: planId,
    tripId: boardId,
    label: 'Zilaff',
    installmentAmount: 33000,
    totalInstallments: 3,
    dayOfMonth: 28,
    startYearMonth: '2026-08',
    paymentMethodId,
    save: jest.fn(),
  };

  function buildExpense(installmentNumber: number, skippedAt?: Date) {
    return {
      installmentNumber,
      skippedAt,
      expenseDate: new Date('2026-08-28T12:00:00.000Z'),
      paymentYearMonth: '2026-08',
      save: jest.fn().mockResolvedValue(undefined),
    };
  }

  function buildService(
    expensesByOccurrenceKey: Map<string, unknown>,
    pendingExpenses: Array<{ installmentNumber: number }> = [],
  ) {
    const plan = { ...basePlan, save: jest.fn().mockResolvedValue(undefined) };
    const installmentPlanModel = {
      findById: jest.fn().mockResolvedValue(plan),
    };
    const expenseModel = {
      findOne: jest.fn(({ occurrenceKey }: { occurrenceKey: string }) =>
        Promise.resolve(expensesByOccurrenceKey.get(occurrenceKey) ?? null),
      ),
      find: jest.fn().mockResolvedValue(pendingExpenses),
    };
    const participantsService = {
      ensureParticipantAccess: jest.fn().mockResolvedValue(undefined),
    };

    const service = new InstallmentPlansService(
      installmentPlanModel as never,
      expenseModel as never,
      {} as never,
      participantsService as never,
      {} as never,
      {} as never,
    );

    return { service, plan };
  }

  it('scope "this" only updates the targeted expense and does not touch the plan default', async () => {
    const expense2 = buildExpense(2);
    const expensesByOccurrenceKey = new Map([
      [`installment:${planId.toString()}:2`, expense2],
    ]);
    const { service, plan } = buildService(expensesByOccurrenceKey);

    const result = await service.rescheduleInstallments(
      planId.toString(),
      {
        installmentNumber: 2,
        dayOfMonth: 15,
        scope: InstallmentRescheduleScope.THIS,
      },
      userId.toString(),
    );

    expect(result.updated).toBe(1);
    expect(plan.save).not.toHaveBeenCalled();
    expect(expense2.save).toHaveBeenCalledTimes(1);
    expect(expense2.expenseDate.toISOString()).toBe('2026-09-15T12:00:00.000Z');
  });

  it('scope "this_and_future" updates this and later installments but not earlier ones', async () => {
    const expense1 = buildExpense(1);
    const expense2 = buildExpense(2);
    const expense3 = buildExpense(3);
    const expensesByOccurrenceKey = new Map([
      [`installment:${planId.toString()}:1`, expense1],
      [`installment:${planId.toString()}:2`, expense2],
      [`installment:${planId.toString()}:3`, expense3],
    ]);
    const { service, plan } = buildService(expensesByOccurrenceKey);

    const result = await service.rescheduleInstallments(
      planId.toString(),
      {
        installmentNumber: 2,
        dayOfMonth: 15,
        scope: InstallmentRescheduleScope.THIS_AND_FUTURE,
      },
      userId.toString(),
    );

    expect(result.updated).toBe(2);
    expect(plan.save).toHaveBeenCalledTimes(1);
    expect(plan.dayOfMonth).toBe(15);
    expect(expense1.save).not.toHaveBeenCalled();
    expect(expense2.save).toHaveBeenCalledTimes(1);
    expect(expense3.save).toHaveBeenCalledTimes(1);
  });

  it('scope "this_and_future" without an installmentNumber resolves the anchor live from pending expenses, ignoring the stale paidInstallments seed', async () => {
    const expense2 = buildExpense(2);
    const expense3 = buildExpense(3);
    const expensesByOccurrenceKey = new Map([
      [`installment:${planId.toString()}:2`, expense2],
      [`installment:${planId.toString()}:3`, expense3],
    ]);
    // Even though the plan's own paidInstallments/dayOfMonth fields are
    // untouched, the live expense state says cuota 1 is already paid and
    // cuota 2 is the first pending one — that's what should be used.
    const { service } = buildService(expensesByOccurrenceKey, [
      { installmentNumber: 2 },
      { installmentNumber: 3 },
    ]);

    const result = await service.rescheduleInstallments(
      planId.toString(),
      {
        dayOfMonth: 15,
        scope: InstallmentRescheduleScope.THIS_AND_FUTURE,
      },
      userId.toString(),
    );

    expect(result.updated).toBe(2);
    expect(expense2.save).toHaveBeenCalledTimes(1);
    expect(expense3.save).toHaveBeenCalledTimes(1);
  });

  it('scope "this_and_future" without an installmentNumber is a no-op when nothing is pending', async () => {
    const { service } = buildService(new Map(), []);

    const result = await service.rescheduleInstallments(
      planId.toString(),
      {
        dayOfMonth: 15,
        scope: InstallmentRescheduleScope.THIS_AND_FUTURE,
      },
      userId.toString(),
    );

    expect(result.updated).toBe(0);
  });

  describe('targetYearMonth (month shift from an individual cuota edit)', () => {
    it('scope "this" moves only the anchor cuota, leaving every other cuota\'s month untouched', async () => {
      const expense1 = buildExpense(1);
      const expense2 = buildExpense(2);
      const expense3 = buildExpense(3);
      const expensesByOccurrenceKey = new Map([
        [`installment:${planId.toString()}:1`, expense1],
        [`installment:${planId.toString()}:2`, expense2],
        [`installment:${planId.toString()}:3`, expense3],
      ]);
      const { service, plan } = buildService(expensesByOccurrenceKey);

      const result = await service.rescheduleInstallments(
        planId.toString(),
        {
          installmentNumber: 2,
          targetYearMonth: '2026-10',
          scope: InstallmentRescheduleScope.THIS,
        },
        userId.toString(),
      );

      expect(result.updated).toBe(1);
      expect(plan.save).not.toHaveBeenCalled();
      expect(expense1.save).not.toHaveBeenCalled();
      expect(expense2.expenseDate.toISOString()).toBe(
        '2026-10-28T12:00:00.000Z',
      );
      expect(expense3.save).not.toHaveBeenCalled();
    });

    it('scope "this_and_future" cascades the same month delta to later cuotas, preserving their spacing', async () => {
      const expense1 = buildExpense(1);
      const expense2 = buildExpense(2);
      const expense3 = buildExpense(3);
      const expensesByOccurrenceKey = new Map([
        [`installment:${planId.toString()}:1`, expense1],
        [`installment:${planId.toString()}:2`, expense2],
        [`installment:${planId.toString()}:3`, expense3],
      ]);
      const { service } = buildService(expensesByOccurrenceKey);

      // cuota2's canonical month is 2026-09; moving it to 2026-10 is a +1
      // delta, which must cascade the same +1 onto cuota3 (2026-10 -> 2026-11).
      const result = await service.rescheduleInstallments(
        planId.toString(),
        {
          installmentNumber: 2,
          targetYearMonth: '2026-10',
          scope: InstallmentRescheduleScope.THIS_AND_FUTURE,
        },
        userId.toString(),
      );

      expect(result.updated).toBe(2);
      expect(expense1.save).not.toHaveBeenCalled();
      expect(expense2.expenseDate.toISOString()).toBe(
        '2026-10-28T12:00:00.000Z',
      );
      expect(expense3.expenseDate.toISOString()).toBe(
        '2026-11-28T12:00:00.000Z',
      );
    });

    it('cascade never rewrites a later cuota that is already paid', async () => {
      const expense2 = buildExpense(2);
      const expense3 = { ...buildExpense(3), status: ExpenseStatus.PAID };
      const expensesByOccurrenceKey = new Map([
        [`installment:${planId.toString()}:2`, expense2],
        [`installment:${planId.toString()}:3`, expense3],
      ]);
      const { service } = buildService(expensesByOccurrenceKey);

      const result = await service.rescheduleInstallments(
        planId.toString(),
        {
          installmentNumber: 2,
          targetYearMonth: '2026-10',
          scope: InstallmentRescheduleScope.THIS_AND_FUTURE,
        },
        userId.toString(),
      );

      expect(result.updated).toBe(1);
      expect(expense2.save).toHaveBeenCalledTimes(1);
      expect(expense3.save).not.toHaveBeenCalled();
    });

    it('cascade never touches a skipped (omitted) cuota', async () => {
      const expense2 = buildExpense(2);
      const expense3Skipped = buildExpense(
        3,
        new Date('2026-09-01T00:00:00.000Z'),
      );
      const expensesByOccurrenceKey = new Map([
        [`installment:${planId.toString()}:2`, expense2],
        [`installment:${planId.toString()}:3`, expense3Skipped],
      ]);
      const { service } = buildService(expensesByOccurrenceKey);

      const result = await service.rescheduleInstallments(
        planId.toString(),
        {
          installmentNumber: 2,
          targetYearMonth: '2026-10',
          scope: InstallmentRescheduleScope.THIS_AND_FUTURE,
        },
        userId.toString(),
      );

      expect(result.updated).toBe(1);
      expect(expense3Skipped.save).not.toHaveBeenCalled();
    });

    it('is rejected for scope "all"', async () => {
      const { service } = buildService(new Map());

      await expect(
        service.rescheduleInstallments(
          planId.toString(),
          {
            installmentNumber: 1,
            targetYearMonth: '2026-10',
            scope: InstallmentRescheduleScope.ALL,
          },
          userId.toString(),
        ),
      ).rejects.toThrow('targetYearMonth no aplica al alcance "all"');
    });
  });

  it('scope "all" updates every non-skipped installment, including already paid ones, but skips omitted occurrences', async () => {
    const expense1 = buildExpense(1);
    const expense2Skipped = buildExpense(
      2,
      new Date('2026-09-01T00:00:00.000Z'),
    );
    const expense3 = buildExpense(3);
    const expensesByOccurrenceKey = new Map([
      [`installment:${planId.toString()}:1`, expense1],
      [`installment:${planId.toString()}:2`, expense2Skipped],
      [`installment:${planId.toString()}:3`, expense3],
    ]);
    const { service, plan } = buildService(expensesByOccurrenceKey);

    const result = await service.rescheduleInstallments(
      planId.toString(),
      {
        installmentNumber: 1,
        dayOfMonth: 15,
        scope: InstallmentRescheduleScope.ALL,
      },
      userId.toString(),
    );

    expect(result.updated).toBe(2);
    expect(plan.dayOfMonth).toBe(15);
    expect(expense1.save).toHaveBeenCalledTimes(1);
    expect(expense2Skipped.save).not.toHaveBeenCalled();
    expect(expense3.save).toHaveBeenCalledTimes(1);
  });
});
