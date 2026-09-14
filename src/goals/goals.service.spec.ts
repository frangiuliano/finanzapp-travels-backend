import { BadRequestException } from '@nestjs/common';
import { Types } from 'mongoose';
import { GoalsService } from './goals.service';

describe('GoalsService', () => {
  const userId = new Types.ObjectId().toString();
  const boardId = new Types.ObjectId();
  const otherBoardId = new Types.ObjectId();
  const goalId = new Types.ObjectId();

  const goalModel = { findOne: jest.fn(), find: jest.fn() };
  const selectionModel = {
    deleteMany: jest.fn(),
    insertMany: jest.fn(),
    find: jest.fn(),
  };
  const checkpointModel = {
    countDocuments: jest.fn(),
    find: jest.fn(),
    updateOne: jest.fn(),
    deleteMany: jest.fn(),
  };
  const holdingModel = { find: jest.fn() };
  const boardModel = { findById: jest.fn() };
  const participantsService = {
    ensureBoardParticipantAccess: jest.fn().mockResolvedValue(undefined),
  };
  const forecastService = { getMonthlyForecastRange: jest.fn() };
  const fxService = { resolveSnapshot: jest.fn() };
  const planner = { evaluate: jest.fn() };

  const service = new GoalsService(
    goalModel as never,
    selectionModel as never,
    checkpointModel as never,
    holdingModel as never,
    boardModel as never,
    participantsService as never,
    forecastService as never,
    fxService as never,
    planner as never,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    // Echoes back the requested id so requireBoard() always returns the
    // *specific* board that was asked for, matching the real service.
    boardModel.findById.mockImplementation((id: string) =>
      Promise.resolve({ _id: new Types.ObjectId(id), baseCurrency: 'ARS' }),
    );
    participantsService.ensureBoardParticipantAccess.mockResolvedValue(
      undefined,
    );
  });

  it('rejects creating a goal that references a holding from another board', async () => {
    holdingModel.find.mockReturnValue({
      select: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue([]), // no holdings found under this board
      }),
    });

    await expect(
      service.createGoal(
        {
          name: 'Viaje',
          targetAmount: 1000,
          currency: 'ARS',
          holdingSelections: [
            { holdingId: new Types.ObjectId().toString() },
          ] as never,
        },
        userId,
        boardId.toString(),
      ),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(
      participantsService.ensureBoardParticipantAccess,
    ).toHaveBeenCalledWith(boardId.toString(), userId);
  });

  it('never silently drops a cross-board holdingId — it rejects the whole request', async () => {
    const ownHolding = new Types.ObjectId();
    holdingModel.find.mockReturnValue({
      select: jest.fn().mockReturnValue({
        // Only one of the two requested holdings actually belongs to this board.
        lean: jest.fn().mockResolvedValue([{ _id: ownHolding }]),
      }),
    });

    await expect(
      service.createGoal(
        {
          name: 'Viaje',
          targetAmount: 1000,
          currency: 'ARS',
          holdingSelections: [
            { holdingId: ownHolding.toString() },
            { holdingId: new Types.ObjectId().toString() },
          ] as never,
        },
        userId,
        boardId.toString(),
      ),
    ).rejects.toThrow('no pertenecen a este tablero');
  });

  it('refuses to hard-delete a goal that already has real tracked history', async () => {
    goalModel.findOne.mockResolvedValue({ _id: goalId, boardId });
    checkpointModel.countDocuments.mockResolvedValue(3);

    await expect(
      service.deleteGoal(goalId.toString(), userId, boardId.toString()),
    ).rejects.toThrow('Archivalo en vez de eliminarlo');
  });

  it('allows hard-deleting a goal with no real checkpoints', async () => {
    goalModel.findOne.mockResolvedValue({ _id: goalId, boardId });
    checkpointModel.countDocuments.mockResolvedValue(0);
    const deleteGoal = jest.fn().mockResolvedValue(undefined);
    (goalModel as { deleteOne?: unknown }).deleteOne = deleteGoal;
    selectionModel.deleteMany.mockResolvedValue(undefined);
    checkpointModel.deleteMany.mockResolvedValue(undefined);

    await service.deleteGoal(goalId.toString(), userId, boardId.toString());

    expect(deleteGoal).toHaveBeenCalledWith({ _id: goalId });
  });

  it('reports insufficient monthly-progress data honestly when fewer than 2 checkpoints exist', async () => {
    goalModel.findOne.mockResolvedValue({
      _id: goalId,
      boardId,
      toObject: () => ({ _id: goalId, boardId }),
    });
    checkpointModel.find.mockReturnValue({
      sort: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue([{ yearMonth: '2026-09' }]),
      }),
    });

    const result = await service.getProgress(
      goalId.toString(),
      userId,
      boardId.toString(),
    );

    expect(result.hasEnoughData).toBe(false);
    expect(result.message).toContain('suficientes mediciones');
  });

  it('rejects reading a goal id that belongs to a different board', async () => {
    goalModel.findOne.mockImplementation(
      (query: { boardId: Types.ObjectId }) => {
        // Mirrors the real query: {_id, boardId} — a mismatched boardId never matches.
        return Promise.resolve(
          query.boardId.equals(boardId) ? { _id: goalId, boardId } : null,
        );
      },
    );

    await expect(
      service.getGoal(goalId.toString(), userId, otherBoardId.toString()),
    ).rejects.toThrow('Objetivo no encontrado');
  });
});
