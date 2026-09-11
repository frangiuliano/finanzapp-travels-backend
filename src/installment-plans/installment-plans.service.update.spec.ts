import { Types } from 'mongoose';
import { ExpenseStatus } from '../expenses/expense.schema';
import { InstallmentPlansService } from './installment-plans.service';
import { InstallmentOverridePolicy } from './dto/update-installment-plan.dto';

interface FakeExpense {
  _id: Types.ObjectId;
  installmentNumber: number;
  occurrenceKey: string;
  amount: number;
  description: string;
  currency: string;
  status: ExpenseStatus;
  expenseDate: Date;
  skippedAt?: Date;
  paymentYearMonth?: string;
  overriddenFields?: string[];
  save: jest.Mock;
}

describe('InstallmentPlansService.update (unified save)', () => {
  const boardId = new Types.ObjectId();
  const userId = new Types.ObjectId();
  const participantId = new Types.ObjectId();
  const planId = new Types.ObjectId();
  const paymentMethodId = new Types.ObjectId();

  function makeExpense(overrides: Partial<FakeExpense>): FakeExpense {
    const expense: FakeExpense = {
      _id: new Types.ObjectId(),
      installmentNumber: 1,
      occurrenceKey: `installment:${planId.toString()}:1`,
      amount: 1000,
      description: 'Compra',
      currency: 'ARS',
      status: ExpenseStatus.PENDING,
      expenseDate: new Date('2026-09-28T12:00:00.000Z'),
      paymentYearMonth: '2026-09',
      overriddenFields: [],
      save: jest.fn(),
      ...overrides,
    };
    expense.save = jest.fn().mockImplementation(() => Promise.resolve(expense));
    return expense;
  }

  function buildHarness(options: {
    totalInstallments: number;
    dayOfMonth: number;
    startYearMonth?: string;
    installmentAmount?: number;
    label?: string;
    paymentMethodId?: Types.ObjectId | null;
    paidInstallments?: number;
    expenses: FakeExpense[];
  }) {
    const plan = {
      _id: planId,
      tripId: boardId,
      label: options.label ?? 'Compra en cuotas',
      installmentAmount: options.installmentAmount ?? 1000,
      totalInstallments: options.totalInstallments,
      paidInstallments: options.paidInstallments ?? 0,
      startYearMonth: options.startYearMonth ?? '2026-09',
      dayOfMonth: options.dayOfMonth,
      paymentMethodId: options.paymentMethodId ?? paymentMethodId,
      currency: 'ARS',
      createdBy: userId,
      isActive: true,
      save: jest.fn(),
      toObject: jest.fn(),
      populate: jest.fn(),
    };
    plan.save = jest.fn().mockImplementation(() => Promise.resolve(plan));
    plan.toObject = jest.fn().mockImplementation(() => ({ ...plan }));
    plan.populate = jest.fn().mockImplementation(() => Promise.resolve(plan));

    const expensesByKey = new Map(
      options.expenses.map((expense) => [expense.occurrenceKey, expense]),
    );

    const installmentPlanModel = {
      findById: jest.fn().mockResolvedValue(plan),
    };

    const expenseModel = {
      find: jest.fn(
        (query: { status?: { $ne: ExpenseStatus }; skippedAt?: unknown }) => {
          const all = Array.from(expensesByKey.values());
          if (query.status?.$ne === ExpenseStatus.PAID) {
            return Promise.resolve(
              all.filter(
                (e) => e.status !== ExpenseStatus.PAID && !e.skippedAt,
              ),
            );
          }
          return Promise.resolve(all);
        },
      ),
      findOne: jest.fn(({ occurrenceKey }: { occurrenceKey: string }) =>
        Promise.resolve(expensesByKey.get(occurrenceKey) ?? null),
      ),
      countDocuments: jest.fn(
        (query: {
          status?: ExpenseStatus;
          skippedAt?: unknown;
          installmentNumber?: { $gt?: number };
        }) => {
          const all = Array.from(expensesByKey.values());
          return Promise.resolve(
            all.filter(
              (e) =>
                e.status === query.status &&
                !e.skippedAt &&
                (query.installmentNumber?.$gt === undefined ||
                  e.installmentNumber > query.installmentNumber.$gt),
            ).length,
          );
        },
      ),
      create: jest.fn((doc: Record<string, unknown>) => {
        const created = makeExpense({
          _id: new Types.ObjectId(),
          installmentNumber: doc.installmentNumber as number,
          occurrenceKey: doc.occurrenceKey as string,
          amount: doc.amount as number,
          description: doc.description as string,
          currency: doc.currency as string,
          status: doc.status as ExpenseStatus,
          expenseDate: doc.expenseDate as Date,
          paymentYearMonth: doc.paymentYearMonth as string | undefined,
          overriddenFields: [],
        });
        expensesByKey.set(created.occurrenceKey, created);
        return Promise.resolve(created);
      }),
      deleteMany: jest.fn(
        (query: {
          installmentNumber?: { $gt?: number; $lte?: number };
          status?: { $ne?: ExpenseStatus };
          skippedAt?: unknown;
        }) => {
          let deletedCount = 0;
          for (const [key, expense] of Array.from(expensesByKey.entries())) {
            const n = expense.installmentNumber;
            if (
              query.installmentNumber?.$gt !== undefined &&
              !(n > query.installmentNumber.$gt)
            ) {
              continue;
            }
            if (
              query.installmentNumber?.$lte !== undefined &&
              !(n <= query.installmentNumber.$lte)
            ) {
              continue;
            }
            if (
              query.status?.$ne !== undefined &&
              expense.status === query.status.$ne
            ) {
              continue;
            }
            if (expense.skippedAt) continue;
            expensesByKey.delete(key);
            deletedCount += 1;
          }
          return Promise.resolve({ deletedCount });
        },
      ),
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
      {} as never,
    );

    return { service, plan, expensesByKey, expenseModel };
  }

  it('saves directly when there are no customized pending cuotas', async () => {
    const { service, plan } = buildHarness({
      totalInstallments: 1,
      dayOfMonth: 10,
      expenses: [],
    });

    const result = await service.update(
      planId.toString(),
      { label: 'Nuevo nombre' },
      userId.toString(),
    );

    expect(result.status).toBe('applied');
    expect(plan.label).toBe('Nuevo nombre');
  });

  it('never touches a skipped (omitted) occurrence when the plan is saved', async () => {
    const skipped = makeExpense({
      installmentNumber: 1,
      occurrenceKey: `installment:${planId.toString()}:1`,
      status: ExpenseStatus.PENDING,
      skippedAt: new Date('2026-09-01T00:00:00.000Z'),
      expenseDate: new Date('2026-09-11T12:00:00.000Z'),
    });
    const { service, expenseModel } = buildHarness({
      totalInstallments: 1,
      dayOfMonth: 11,
      expenses: [skipped],
    });

    const result = await service.update(
      planId.toString(),
      { dayOfMonth: 15 },
      userId.toString(),
    );

    expect(result.status).toBe('applied');
    expect(skipped.save).not.toHaveBeenCalled();
    expect(skipped.expenseDate.toISOString()).toBe('2026-09-11T12:00:00.000Z');
    expect(expenseModel.deleteMany).toHaveBeenCalledWith(
      expect.objectContaining({
        skippedAt: { $exists: false },
      }),
    );
  });

  it('reports needs_decision for a customized pending cuota when the plan amount changes, and preserves it with policy "preserve"', async () => {
    const customized = makeExpense({
      installmentNumber: 1,
      occurrenceKey: `installment:${planId.toString()}:1`,
      status: ExpenseStatus.PENDING,
      amount: 5000,
      description: 'Monto corregido a mano',
      overriddenFields: ['amount', 'description'],
    });
    const { service } = buildHarness({
      totalInstallments: 1,
      dayOfMonth: 10,
      installmentAmount: 1000,
      expenses: [customized],
    });

    const preflight = await service.update(
      planId.toString(),
      { installmentAmount: 1200 },
      userId.toString(),
    );
    expect(preflight.status).toBe('needs_decision');
    if (preflight.status !== 'needs_decision') throw new Error('unreachable');
    expect(preflight.customOverrides.count).toBe(1);
    expect(preflight.customOverrides.items[0]).toMatchObject({
      installmentNumber: 1,
      amount: 5000,
      description: 'Monto corregido a mano',
    });

    const applied = await service.update(
      planId.toString(),
      {
        installmentAmount: 1200,
        overridePolicy: InstallmentOverridePolicy.PRESERVE,
      },
      userId.toString(),
    );
    expect(applied.status).toBe('applied');
    expect(customized.amount).toBe(5000);
    expect(customized.description).toBe('Monto corregido a mano');
  });

  it('replaces a customized pending cuota only with explicit policy "replace", clearing overriddenFields', async () => {
    const customized = makeExpense({
      installmentNumber: 1,
      occurrenceKey: `installment:${planId.toString()}:1`,
      status: ExpenseStatus.PENDING,
      amount: 5000,
      description: 'Monto corregido a mano',
      overriddenFields: ['amount', 'description'],
    });
    const { service } = buildHarness({
      totalInstallments: 1,
      dayOfMonth: 10,
      installmentAmount: 1000,
      label: 'Plan label',
      expenses: [customized],
    });

    const applied = await service.update(
      planId.toString(),
      {
        installmentAmount: 1200,
        overridePolicy: InstallmentOverridePolicy.REPLACE,
      },
      userId.toString(),
    );

    expect(applied.status).toBe('applied');
    expect(customized.amount).toBe(1200);
    expect(customized.description).toBe('Plan label');
    expect(customized.overriddenFields).toEqual([]);
  });

  it('changing startYearMonth shifts pending cuotas but never touches paid ones', async () => {
    const paid = makeExpense({
      installmentNumber: 1,
      occurrenceKey: `installment:${planId.toString()}:1`,
      status: ExpenseStatus.PAID,
      expenseDate: new Date('2026-08-10T12:00:00.000Z'),
    });
    const pending = makeExpense({
      installmentNumber: 2,
      occurrenceKey: `installment:${planId.toString()}:2`,
      status: ExpenseStatus.PENDING,
      expenseDate: new Date('2026-09-10T12:00:00.000Z'),
    });
    const { service, plan } = buildHarness({
      totalInstallments: 2,
      dayOfMonth: 10,
      startYearMonth: '2026-08',
      expenses: [paid, pending],
    });

    const result = await service.update(
      planId.toString(),
      { startYearMonth: '2026-09' },
      userId.toString(),
    );

    expect(result.status).toBe('applied');
    expect(plan.startYearMonth).toBe('2026-09');
    expect(paid.expenseDate.toISOString()).toBe('2026-08-10T12:00:00.000Z');
    expect(pending.expenseDate.toISOString()).toBe('2026-10-10T12:00:00.000Z');
  });

  it('never changes amount/description of paid cuotas on a plan-level save', async () => {
    const paid = makeExpense({
      installmentNumber: 1,
      occurrenceKey: `installment:${planId.toString()}:1`,
      status: ExpenseStatus.PAID,
      amount: 999,
      description: 'Descripción original',
      expenseDate: new Date('2026-08-11T12:00:00.000Z'),
    });
    const { service } = buildHarness({
      totalInstallments: 1,
      dayOfMonth: 11,
      installmentAmount: 5000,
      label: 'Label nuevo',
      expenses: [paid],
    });

    const result = await service.update(
      planId.toString(),
      {
        installmentAmount: 5000,
        label: 'Label nuevo',
      },
      userId.toString(),
    );

    expect(result.status).toBe('applied');
    expect(paid.amount).toBe(999);
    expect(paid.description).toBe('Descripción original');
  });

  it('creates missing occurrences when totalInstallments grows, using consistent payment-month data', async () => {
    const { service, expensesByKey } = buildHarness({
      totalInstallments: 1,
      dayOfMonth: 10,
      startYearMonth: '2026-09',
      expenses: [],
    });

    const result = await service.update(
      planId.toString(),
      { totalInstallments: 2 },
      userId.toString(),
    );

    expect(result.status).toBe('applied');
    const created = expensesByKey.get(`installment:${planId.toString()}:2`);
    expect(created).toBeDefined();
    expect(created?.paymentYearMonth).toBe('2026-10');
  });

  it('conservatively detects a legacy cuota as customized (no overriddenFields metadata) when its amount differs from the plan', async () => {
    const legacyCustomized = makeExpense({
      installmentNumber: 1,
      occurrenceKey: `installment:${planId.toString()}:1`,
      status: ExpenseStatus.PENDING,
      amount: 3333, // hand-edited before overriddenFields metadata existed
      description: 'Compra en cuotas', // matches the plan label
      overriddenFields: undefined,
    });
    const { service } = buildHarness({
      totalInstallments: 1,
      dayOfMonth: 10,
      installmentAmount: 1000,
      label: 'Compra en cuotas',
      expenses: [legacyCustomized],
    });

    const preflight = await service.update(
      planId.toString(),
      { installmentAmount: 1200 },
      userId.toString(),
    );

    expect(preflight.status).toBe('needs_decision');
    if (preflight.status !== 'needs_decision') throw new Error('unreachable');
    expect(preflight.customOverrides.count).toBe(1);
    expect(preflight.customOverrides.items[0].amount).toBe(3333);
  });

  describe('editing paidInstallments (the "already paid before tracking" seed)', () => {
    it('rejects a value greater than the resulting totalInstallments', async () => {
      const { service } = buildHarness({
        totalInstallments: 3,
        dayOfMonth: 28,
        paidInstallments: 0,
        expenses: [],
      });

      await expect(
        service.update(
          planId.toString(),
          { paidInstallments: 5 },
          userId.toString(),
        ),
      ).rejects.toThrow('paidInstallments no puede superar totalInstallments');
    });

    it('raising it deletes stale pending cuotas that fall inside the new seed range, never touching paid ones', async () => {
      const cuota1 = makeExpense({
        installmentNumber: 1,
        occurrenceKey: `installment:${planId.toString()}:1`,
        status: ExpenseStatus.PENDING,
      });
      const cuota2 = makeExpense({
        installmentNumber: 2,
        occurrenceKey: `installment:${planId.toString()}:2`,
        status: ExpenseStatus.PAID,
      });
      const cuota3 = makeExpense({
        installmentNumber: 3,
        occurrenceKey: `installment:${planId.toString()}:3`,
        status: ExpenseStatus.PENDING,
        expenseDate: new Date('2026-11-28T12:00:00.000Z'),
      });
      const { service, expensesByKey } = buildHarness({
        totalInstallments: 3,
        dayOfMonth: 28,
        paidInstallments: 0,
        expenses: [cuota1, cuota2, cuota3],
      });

      const result = await service.update(
        planId.toString(),
        { paidInstallments: 2 },
        userId.toString(),
      );

      expect(result.status).toBe('applied');
      // Pending cuota inside the new seed range: dropped, not resurrected.
      expect(expensesByKey.has(`installment:${planId.toString()}:1`)).toBe(
        false,
      );
      // Already-paid cuota inside the new seed range: paid history untouched.
      expect(expensesByKey.has(`installment:${planId.toString()}:2`)).toBe(
        true,
      );
      // Beyond the seed: unaffected.
      expect(expensesByKey.has(`installment:${planId.toString()}:3`)).toBe(
        true,
      );
    });

    it('lowering it materializes newly-unseeded cuotas via the normal reconcile pass', async () => {
      const cuota3 = makeExpense({
        installmentNumber: 3,
        occurrenceKey: `installment:${planId.toString()}:3`,
        status: ExpenseStatus.PENDING,
        expenseDate: new Date('2026-11-28T12:00:00.000Z'),
      });
      const { service, expensesByKey } = buildHarness({
        totalInstallments: 3,
        dayOfMonth: 28,
        paidInstallments: 2,
        expenses: [cuota3],
      });

      const result = await service.update(
        planId.toString(),
        { paidInstallments: 0 },
        userId.toString(),
      );

      expect(result.status).toBe('applied');
      expect(expensesByKey.has(`installment:${planId.toString()}:1`)).toBe(
        true,
      );
      expect(expensesByKey.has(`installment:${planId.toString()}:2`)).toBe(
        true,
      );
    });
  });
});
