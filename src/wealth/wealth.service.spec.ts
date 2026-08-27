import { BadRequestException } from '@nestjs/common';
import { Types } from 'mongoose';
import { WealthService } from './wealth.service';
import {
  HoldingType,
  SavingsGoalStatus,
  WealthEventKind,
} from './wealth.schemas';

describe('WealthService', () => {
  const userId = new Types.ObjectId().toString();
  const boardId = new Types.ObjectId().toString();
  const holdingId = new Types.ObjectId();
  const goalId = new Types.ObjectId();
  const holdingModel = {
    findOne: jest.fn(),
    findOneAndUpdate: jest.fn(),
    updateOne: jest.fn(),
  };
  const goalModel = { findOne: jest.fn() };
  const allocationModel = {
    findOne: jest.fn(),
    findOneAndUpdate: jest.fn(),
  };
  const eventModel = { create: jest.fn() };
  const instrumentModel = { updateOne: jest.fn() };
  const positionModel = { find: jest.fn() };
  const transactionModel = { create: jest.fn() };
  const service = new WealthService(
    holdingModel as never,
    goalModel as never,
    allocationModel as never,
    eventModel as never,
    instrumentModel as never,
    positionModel as never,
    transactionModel as never,
    {} as never,
    {} as never,
    {} as never,
  );

  const holding = {
    _id: holdingId,
    userId: new Types.ObjectId(userId),
    name: 'Ahorros',
    type: HoldingType.BANK_ACCOUNT,
    currency: 'ARS',
    currentBalance: 1000,
    allocatedBalance: 200,
    isActive: true,
    save: jest.fn(),
  };
  const goal = {
    _id: goalId,
    userId: new Types.ObjectId(userId),
    name: 'Viaje',
    currency: 'ARS',
    targetAmount: 2000,
    priority: 100,
    status: SavingsGoalStatus.ACTIVE,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    jest
      .spyOn(
        service as unknown as { prepareBoard: () => Promise<void> },
        'prepareBoard',
      )
      .mockResolvedValue();
    holdingModel.findOne.mockResolvedValue(holding);
    goalModel.findOne.mockResolvedValue(goal);
    allocationModel.findOne.mockResolvedValue({ amount: 200 });
  });

  it('rejects lowering a holding below money allocated to goals', async () => {
    await expect(
      service.adjustBalance(
        holdingId.toString(),
        { balance: 199 },
        userId,
        boardId,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects a contribution when the atomic available-balance guard fails', async () => {
    holdingModel.findOneAndUpdate.mockResolvedValue(null);

    await expect(
      service.contribute(
        goalId.toString(),
        {
          holdingId: holdingId.toString(),
          kind: WealthEventKind.CONTRIBUTION,
          amount: 900,
        },
        userId,
        boardId,
      ),
    ).rejects.toThrow('El saldo disponible no alcanza');

    expect(allocationModel.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it('rejects withdrawing more than the allocation for that goal', async () => {
    await expect(
      service.contribute(
        goalId.toString(),
        {
          holdingId: holdingId.toString(),
          kind: WealthEventKind.WITHDRAWAL,
          amount: 201,
        },
        userId,
        boardId,
      ),
    ).rejects.toThrow('No hay suficiente dinero asignado');

    expect(holdingModel.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it('rejects allocations across different currencies', async () => {
    goalModel.findOne.mockResolvedValue({ ...goal, currency: 'USD' });

    await expect(
      service.contribute(
        goalId.toString(),
        {
          holdingId: holdingId.toString(),
          kind: WealthEventKind.CONTRIBUTION,
          amount: 100,
        },
        userId,
        boardId,
      ),
    ).rejects.toThrow('deben usar la misma moneda');
  });

  it('calculates progress across multiple holdings without double counting', () => {
    const targetDate = new Date();
    targetDate.setMonth(targetDate.getMonth() + 4);

    const projection = service['enrichGoal'](
      {
        _id: goalId,
        targetAmount: 2000,
        targetDate,
        plannedMonthlyContribution: 250,
      },
      [
        { goalId, holdingId, amount: 300 },
        { goalId, holdingId: new Types.ObjectId(), amount: 200 },
      ],
      [],
    );

    expect(projection.allocatedAmount).toBe(500);
    expect(projection.remainingAmount).toBe(1500);
    expect(projection.progressPercent).toBe(25);
    expect(projection.requiredMonthlyContribution).toBeGreaterThan(0);
    expect(projection.estimatedCompletionDate).not.toBeNull();
  });
});
