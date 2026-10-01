import { Types } from 'mongoose';
import { RecurringMaterializationService } from './recurring-materialization.service';

const query = (items: unknown[]) => ({
  select: jest.fn().mockReturnThis(),
  lean: jest.fn().mockResolvedValue(items),
});

describe('Recurring materialization batching', () => {
  const boardId = new Types.ObjectId();
  const userId = new Types.ObjectId();
  const incomeId = new Types.ObjectId();
  const expenseId = new Types.ObjectId();
  const participantId = new Types.ObjectId();
  const incomeRules = { find: jest.fn() };
  const expenseRules = { find: jest.fn() };
  const incomeVersions = { find: jest.fn(), countDocuments: jest.fn() };
  const expenseVersions = { find: jest.fn(), countDocuments: jest.fn() };
  const incomes = { find: jest.fn(), findOne: jest.fn(), bulkWrite: jest.fn() };
  const expenses = {
    find: jest.fn(),
    findOne: jest.fn(),
    bulkWrite: jest.fn(),
    updateMany: jest.fn(),
  };
  const access = { ensureParticipantAccess: jest.fn() };
  let service: RecurringMaterializationService;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers().setSystemTime(new Date('2026-09-10T12:00:00Z'));
    incomeRules.find.mockReturnValue(
      query([
        {
          _id: incomeId,
          tripId: boardId,
          isActive: true,
          amount: 1000,
          currency: 'ARS',
          label: 'Sueldo',
          daysOfMonth: [5],
          createdBy: userId,
        },
      ]),
    );
    expenseRules.find.mockReturnValue(
      query([
        {
          _id: expenseId,
          tripId: boardId,
          isActive: true,
          amount: 100,
          currency: 'ARS',
          label: 'Alquiler',
          dayOfMonth: 10,
          createdBy: userId,
        },
      ]),
    );
    incomeVersions.find.mockReturnValue(
      query([
        { recurringIncomeId: incomeId, effectiveFrom: '2026-09', amount: 1000 },
      ]),
    );
    expenseVersions.find.mockReturnValue(
      query([
        {
          recurringExpenseId: expenseId,
          effectiveFrom: '2026-09',
          amount: 100,
        },
      ]),
    );
    incomes.find.mockReturnValue(query([]));
    expenses.find.mockReturnValue(query([]));
    incomes.bulkWrite.mockImplementation((operations: unknown[]) =>
      Promise.resolve({ upsertedCount: operations.length }),
    );
    expenses.bulkWrite.mockImplementation((operations: unknown[]) =>
      Promise.resolve({ upsertedCount: operations.length }),
    );
    access.ensureParticipantAccess.mockResolvedValue(undefined);
    service = new RecurringMaterializationService(
      incomeRules as never,
      incomeVersions as never,
      expenseRules as never,
      expenseVersions as never,
      incomes as never,
      expenses as never,
      { find: () => query([{ _id: participantId, userId }]) } as never,
      access as never,
      {
        findByIdOrFail: () => Promise.resolve({ baseCurrency: 'ARS' }),
      } as never,
      { buildFxOnCreate: () => null } as never,
    );
  });

  afterEach(() => jest.useRealTimers());

  it('generates missing occurrences in bulk and shares concurrent requests', async () => {
    const results = await Promise.all([
      service.ensureHorizon(String(boardId), String(userId), 12),
      service.ensureHorizon(String(boardId), String(userId), 12),
    ]);
    expect(results[0]).toEqual({ generated: 24, horizonEnd: '2027-08' });
    expect(incomes.find).toHaveBeenCalledTimes(1);
    expect(expenses.find).toHaveBeenCalledTimes(1);
    expect(incomes.findOne).not.toHaveBeenCalled();
    expect(expenses.findOne).not.toHaveBeenCalled();
    expect(incomeVersions.countDocuments).not.toHaveBeenCalled();
    expect(expenseVersions.countDocuments).not.toHaveBeenCalled();
    const [operations, options] = expenses.bulkWrite.mock.calls[0] as [
      Array<{ updateOne: { update: { $setOnInsert: unknown } } }>,
      unknown,
    ];
    const operation = operations[0];
    expect(operation.updateOne.update.$setOnInsert).toEqual(
      expect.objectContaining({
        amount: 100,
        status: 'pending',
        paymentYearMonth: '2026-09',
        paidByParticipantId: participantId,
      }),
    );
    expect(options).toEqual({
      ordered: false,
      timestamps: false,
    });
  });

  it('keeps existing, skipped and rescheduled occurrences without rewriting them', async () => {
    incomes.find.mockReturnValue(
      query([{ occurrenceKey: `ri:${String(incomeId)}:2026-09:5` }]),
    );
    expenses.find.mockReturnValue(
      query([{ occurrenceKey: `re:${String(expenseId)}:2026-09:10` }]),
    );
    expect(
      await service.ensureHorizon(String(boardId), String(userId), 1),
    ).toEqual({ generated: 0, horizonEnd: '2026-09' });
    expect(incomes.bulkWrite).not.toHaveBeenCalled();
    expect(expenses.bulkWrite).not.toHaveBeenCalled();
    expect(expenses.find).toHaveBeenCalledWith({
      tripId: boardId,
      recurringExpenseId: { $exists: true },
    });
    expect(incomes.find).toHaveBeenCalledWith({
      tripId: boardId,
      recurringIncomeId: { $exists: true },
    });
  });

  it('checks authorization even when another call is doing the work', async () => {
    access.ensureParticipantAccess.mockRejectedValue(new Error('forbidden'));
    await expect(
      service.ensureHorizon(String(boardId), String(userId)),
    ).rejects.toThrow('forbidden');
    expect(incomes.find).not.toHaveBeenCalled();
  });
});
