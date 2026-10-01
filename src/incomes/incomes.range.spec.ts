import { Types } from 'mongoose';
import { IncomesService } from './incomes.service';
import { BoardType } from '../trips/board.schema';

describe('Monthly summary range', () => {
  it('reads the range once and preserves month boundaries, refunds, travel shares and separate currencies', async () => {
    const boardId = new Types.ObjectId();
    const travelId = new Types.ObjectId();
    const participantId = new Types.ObjectId();
    const incomes = {
      find: jest.fn().mockReturnValue({
        lean: () =>
          Promise.resolve([
            {
              incomeDate: new Date('2026-09-01T00:00:00Z'),
              amount: 1000,
              currency: 'ARS',
            },
            {
              incomeDate: new Date('2026-10-01T00:00:00Z'),
              amount: 2000,
              currency: 'ARS',
            },
            {
              incomeDate: new Date('2026-10-15T00:00:00Z'),
              amount: 50,
              currency: 'USD',
            },
          ]),
      }),
    };
    const expenses = {
      find: jest.fn().mockReturnValue({
        lean: () =>
          Promise.resolve([
            {
              tripId: boardId,
              paymentYearMonth: '2026-09',
              amount: 200,
              currency: 'ARS',
            },
            {
              tripId: boardId,
              paymentYearMonth: '2026-09',
              amount: -50,
              currency: 'ARS',
            },
            {
              tripId: travelId,
              paymentYearMonth: '2026-09',
              amount: 600,
              currency: 'ARS',
              isDivisible: true,
              splits: [{ participantId, amount: 100 }],
            },
            {
              tripId: travelId,
              paymentYearMonth: '2026-10',
              amount: -100,
              currency: 'ARS',
              isDivisible: false,
              paidByParticipantId: participantId,
            },
            {
              tripId: travelId,
              paymentYearMonth: '2026-10',
              amount: 500,
              currency: 'ARS',
              isDivisible: false,
              paidByParticipantId: new Types.ObjectId(),
            },
          ]),
      }),
    };
    const scope = {
      findExpenseScopeContext: jest.fn().mockResolvedValue([
        {
          board: {
            _id: boardId,
            type: BoardType.EVERYDAY,
            baseCurrency: 'ARS',
          },
          participantId,
        },
        { board: { _id: travelId, type: BoardType.TRAVEL }, participantId },
      ]),
    };
    const access = {
      ensureParticipantAccess: jest.fn().mockResolvedValue(undefined),
    };
    const service = new IncomesService(
      incomes as never,
      expenses as never,
      access as never,
      scope as never,
      {} as never,
      {} as never,
    );
    const result = await service.getMonthlySummaryRange(
      String(boardId),
      '2026-09',
      3,
      'user',
    );
    expect(
      result.map((r) => [
        r.yearMonth,
        r.totalIncomes,
        r.totalExpenses,
        r.remaining,
      ]),
    ).toEqual([
      ['2026-09', 1000, 250, 750],
      ['2026-10', 2000, -100, 2100],
      ['2026-11', 0, 0, 0],
    ]);
    expect(result[1].incomesByCurrency).toEqual([
      expect.objectContaining({ currency: 'USD', total: 50 }),
    ]);
    expect(incomes.find).toHaveBeenCalledTimes(1);
    expect(expenses.find).toHaveBeenCalledTimes(1);
    expect(scope.findExpenseScopeContext).toHaveBeenCalledTimes(1);
    expect(incomes.find).toHaveBeenCalledWith(
      expect.objectContaining({
        incomeDate: {
          $gte: new Date('2026-09-01'),
          $lt: new Date('2026-12-01'),
        },
      }),
    );
  });
});
