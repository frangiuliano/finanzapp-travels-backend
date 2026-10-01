import { Types } from 'mongoose';
import { ExpensesService } from './expenses.service';
import { BoardType } from '../trips/board.schema';

describe('Recent expenses', () => {
  it('filters personal travel shares before limiting, preserves refunds and only loads category relations', async () => {
    const boardId = new Types.ObjectId();
    const travelId = new Types.ObjectId();
    const participantId = new Types.ObjectId();
    const query = {
      populate: jest.fn().mockReturnThis(),
      sort: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue([
        {
          _id: new Types.ObjectId(),
          tripId: travelId,
          amount: -100,
          currency: 'ARS',
          isDivisible: true,
          splits: [{ participantId, amount: -50 }],
          createdBy: new Types.ObjectId(),
        },
      ]),
    };
    const model = { find: jest.fn().mockReturnValue(query) };
    const boards = {
      findExpenseScopeContext: jest.fn().mockResolvedValue([
        {
          board: {
            _id: boardId,
            type: BoardType.EVERYDAY,
            baseCurrency: 'ARS',
          },
          participantId,
        },
        {
          board: { _id: travelId, type: BoardType.TRAVEL, name: 'Viaje' },
          participantId,
        },
      ]),
    };
    const service = new ExpensesService(
      model as never,
      {} as never,
      {} as never,
      boards as never,
      {} as never,
      {} as never,
      {} as never,
      { resolveDisplayFx: () => null } as never,
      {} as never,
    );
    const result = await service.findRecentByMonth(
      String(boardId),
      'user',
      '2026-10',
    );
    expect(model.find).toHaveBeenCalledWith(
      expect.objectContaining({
        paymentYearMonth: '2026-10',
        tripId: { $in: [boardId, travelId] },
        $and: [
          {
            $or: [
              { tripId: boardId },
              {
                tripId: travelId,
                $or: [
                  {
                    isDivisible: true,
                    splits: {
                      $elemMatch: { participantId, amount: { $ne: 0 } },
                    },
                  },
                  {
                    isDivisible: { $ne: true },
                    paidByParticipantId: participantId,
                    amount: { $ne: 0 },
                  },
                ],
              },
            ],
          },
        ],
      }),
    );
    expect(query.limit).toHaveBeenCalledWith(5);
    expect(query.sort).toHaveBeenCalledWith({ createdAt: -1, _id: -1 });
    expect(query.populate).toHaveBeenCalledWith([
      { path: 'categoryId', select: '_id name icon color isActive' },
    ]);
    expect(result[0].amount).toBe(-50);
  });

  it('does not query expenses when the board scope is unauthorized', async () => {
    const model = { find: jest.fn() };
    const boards = {
      findExpenseScopeContext: jest
        .fn()
        .mockRejectedValue(new Error('forbidden')),
    };
    const service = new ExpensesService(
      model as never,
      {} as never,
      {} as never,
      boards as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
    await expect(
      service.findRecentByMonth(
        String(new Types.ObjectId()),
        'user',
        '2026-10',
      ),
    ).rejects.toThrow('forbidden');
    expect(model.find).not.toHaveBeenCalled();
  });
});
