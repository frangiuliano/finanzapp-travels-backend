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

  describe('getPrioritySummary', () => {
    it('returns goal: null when the board has no active goals', async () => {
      goalModel.find.mockReturnValue({ lean: jest.fn().mockResolvedValue([]) });

      const result = await service.getPrioritySummary(
        userId,
        boardId.toString(),
      );

      expect(result.goal).toBeNull();
    });

    it('picks the goal with priority 1 over a lower-priority one', async () => {
      const lowPriority = {
        _id: new Types.ObjectId(),
        name: 'Prioridad baja',
        priority: 5,
        currency: 'ARS',
        targetAmount: 1000,
        status: 'active',
        createdAt: new Date('2026-01-01'),
        useEstimatedFxForForecast: false,
      };
      const highPriority = {
        _id: new Types.ObjectId(),
        name: 'Prioridad alta',
        priority: 1,
        currency: 'ARS',
        targetAmount: 1000,
        status: 'active',
        createdAt: new Date('2026-01-01'),
        useEstimatedFxForForecast: false,
      };
      goalModel.find.mockReturnValue({
        lean: jest.fn().mockResolvedValue([lowPriority, highPriority]),
      });
      selectionModel.find.mockReturnValue({
        lean: jest.fn().mockResolvedValue([]),
      });
      forecastService.getMonthlyForecastRange.mockResolvedValue([
        { yearMonth: '2026-09', planned: { projectedRemaining: 1000 } },
      ]);
      planner.evaluate.mockReturnValue({
        goals: [
          {
            goalId: highPriority._id.toString(),
            requiredMonthlyContributionIndividual: 1000,
            forecastCapacityComputable: true,
            currentComputableValueJoint: 0,
          },
        ],
      });

      const result = await service.getPrioritySummary(
        userId,
        boardId.toString(),
      );

      expect(result.goal?.id).toBe(highPriority._id.toString());
    });

    it('shows nothing still needed once prior months already banked enough to fully fund the goal', async () => {
      const goal = {
        _id: new Types.ObjectId(),
        name: 'Viaje',
        priority: 1,
        currency: 'ARS',
        targetAmount: 4000,
        status: 'active',
        createdAt: new Date('2026-01-01'),
        useEstimatedFxForForecast: false,
      };
      goalModel.find.mockReturnValue({
        lean: jest.fn().mockResolvedValue([goal]),
      });
      selectionModel.find.mockReturnValue({
        lean: jest.fn().mockResolvedValue([]),
      });
      // Ya tiene 1.000 hoy (falta 3.000). Sep y oct aportan 1.500 cada uno
      // (real, sin techo) — para nov ya está completo.
      forecastService.getMonthlyForecastRange.mockResolvedValue([
        { yearMonth: '2026-09', planned: { projectedRemaining: 1500 } },
        { yearMonth: '2026-10', planned: { projectedRemaining: 1500 } },
        { yearMonth: '2026-11', planned: { projectedRemaining: 1500 } },
      ]);
      planner.evaluate.mockReturnValue({
        goals: [
          {
            goalId: goal._id.toString(),
            requiredMonthlyContributionIndividual: 1000,
            forecastCapacityComputable: true,
            currentComputableValueJoint: 1000,
          },
        ],
      });

      const result = await service.getPrioritySummary(
        userId,
        boardId.toString(),
        '2026-11',
      );

      expect(result.neededThisMonth).toBe(0);
      expect(result.isFullyCovered).toBe(true);
      expect(result.thisMonthContribution).toBe(0);
    });

    it("carries whatever a month's own capacity couldn't cover into neededThisMonth for that same month", async () => {
      const goal = {
        _id: new Types.ObjectId(),
        name: 'Viaje',
        priority: 1,
        currency: 'ARS',
        targetAmount: 4000,
        status: 'active',
        createdAt: new Date('2026-01-01'),
        useEstimatedFxForForecast: false,
      };
      goalModel.find.mockReturnValue({
        lean: jest.fn().mockResolvedValue([goal]),
      });
      selectionModel.find.mockReturnValue({
        lean: jest.fn().mockResolvedValue([]),
      });
      // Ya tiene 1.000 (falta 3.000). Sep aporta 1.000, oct 1.500 (quedan
      // 500 por cubrir), y nov solo tiene 200 de restante proyectado — no
      // le alcanza para cerrar esos 500.
      forecastService.getMonthlyForecastRange.mockResolvedValue([
        { yearMonth: '2026-09', planned: { projectedRemaining: 1000 } },
        { yearMonth: '2026-10', planned: { projectedRemaining: 1500 } },
        { yearMonth: '2026-11', planned: { projectedRemaining: 200 } },
      ]);
      planner.evaluate.mockReturnValue({
        goals: [
          {
            goalId: goal._id.toString(),
            requiredMonthlyContributionIndividual: 1000,
            forecastCapacityComputable: true,
            currentComputableValueJoint: 1000,
          },
        ],
      });

      const result = await service.getPrioritySummary(
        userId,
        boardId.toString(),
        '2026-11',
      );

      expect(result.isFullyCovered).toBe(false);
      expect(result.thisMonthContribution).toBe(200);
      expect(result.neededThisMonth).toBe(300);
    });

    it("caps thisMonthContribution at the month's own real capacity when it falls short of what's still missing", async () => {
      const goal = {
        _id: new Types.ObjectId(),
        name: 'Viaje',
        priority: 1,
        currency: 'ARS',
        targetAmount: 1000,
        status: 'active',
        createdAt: new Date('2026-01-01'),
        useEstimatedFxForForecast: false,
      };
      goalModel.find.mockReturnValue({
        lean: jest.fn().mockResolvedValue([goal]),
      });
      selectionModel.find.mockReturnValue({
        lean: jest.fn().mockResolvedValue([]),
      });
      forecastService.getMonthlyForecastRange.mockResolvedValue([
        { yearMonth: '2026-09', planned: { projectedRemaining: 600 } },
      ]);
      planner.evaluate.mockReturnValue({
        goals: [
          {
            goalId: goal._id.toString(),
            requiredMonthlyContributionIndividual: 1000,
            forecastCapacityComputable: true,
            currentComputableValueJoint: 0,
          },
        ],
      });

      const result = await service.getPrioritySummary(
        userId,
        boardId.toString(),
        '2026-09',
      );

      expect(result.thisMonthContribution).toBe(600);
      expect(result.neededThisMonth).toBe(400);
    });

    it('reports not computable when the top goal has no target date and no desired monthly contribution', async () => {
      const goal = {
        _id: new Types.ObjectId(),
        name: 'Sin plan',
        priority: 1,
        currency: 'ARS',
        targetAmount: 1000,
        status: 'active',
        createdAt: new Date('2026-01-01'),
        useEstimatedFxForForecast: false,
      };
      goalModel.find.mockReturnValue({
        lean: jest.fn().mockResolvedValue([goal]),
      });
      selectionModel.find.mockReturnValue({
        lean: jest.fn().mockResolvedValue([]),
      });
      forecastService.getMonthlyForecastRange.mockResolvedValue([
        { yearMonth: '2026-09', planned: { projectedRemaining: 1000 } },
      ]);
      planner.evaluate.mockReturnValue({
        goals: [
          {
            goalId: goal._id.toString(),
            requiredMonthlyContributionIndividual: null,
            forecastCapacityComputable: true,
          },
        ],
      });

      const result = await service.getPrioritySummary(
        userId,
        boardId.toString(),
      );

      expect(result.computable).toBe(false);
      expect(result.neededThisMonth).toBeNull();
    });

    it("stops reporting a figure for any month past the goal's own projected completion", async () => {
      const goal = {
        _id: new Types.ObjectId(),
        name: 'Casa',
        priority: 1,
        currency: 'ARS',
        targetAmount: 26000,
        status: 'active',
        createdAt: new Date('2026-01-01'),
        useEstimatedFxForForecast: false,
      };
      goalModel.find.mockReturnValue({
        lean: jest.fn().mockResolvedValue([goal]),
      });
      selectionModel.find.mockReturnValue({
        lean: jest.fn().mockResolvedValue([]),
      });
      // Planner says this goal will be done by 2026-11 — asking about a
      // much later month shouldn't run the catch-up math at all, let alone
      // report a perpetual $0.
      planner.evaluate.mockReturnValue({
        goals: [
          {
            goalId: goal._id.toString(),
            requiredMonthlyContributionIndividual: 1000,
            forecastCapacityComputable: true,
            estimatedCompletionYearMonthJoint: '2026-11',
          },
        ],
      });

      const result = await service.getPrioritySummary(
        userId,
        boardId.toString(),
        '2027-08',
      );

      expect(result.neededThisMonth).toBeNull();
      expect(result.isFullyCovered).toBe(true);
      // Only the one call evaluateGoals() makes for the planner itself — the
      // cutoff must skip the extra cumulative-sum fetch entirely.
      expect(forecastService.getMonthlyForecastRange).toHaveBeenCalledTimes(1);
    });
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
