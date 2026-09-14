import { BadRequestException } from '@nestjs/common';
import { Types } from 'mongoose';
import { WealthService } from './wealth.service';
import { HoldingType, InvestmentTransactionType } from './wealth.schemas';

describe('WealthService', () => {
  const userId = new Types.ObjectId().toString();
  const boardId = new Types.ObjectId().toString();
  const holdingId = new Types.ObjectId();
  const holdingModel = {
    findOne: jest.fn(),
    findOneAndUpdate: jest.fn(),
    updateOne: jest.fn(),
  };
  const eventModel = { create: jest.fn() };
  const instrumentModel = { updateOne: jest.fn() };
  const positionModel = { find: jest.fn() };
  const transactionModel = { create: jest.fn(), find: jest.fn() };
  const service = new WealthService(
    holdingModel as never,
    eventModel as never,
    instrumentModel as never,
    positionModel as never,
    transactionModel as never,
    {} as never,
    {} as never,
    {} as never,
    { search: jest.fn().mockResolvedValue([]) } as never,
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

  beforeEach(() => {
    jest.clearAllMocks();
    jest
      .spyOn(
        service as unknown as { prepareBoard: () => Promise<void> },
        'prepareBoard',
      )
      .mockResolvedValue();
    holdingModel.findOne.mockResolvedValue(holding);
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

  it('recovers available investment cash for holdings created before cashBalance', async () => {
    const legacyHolding = {
      ...holding,
      type: HoldingType.INVESTMENT,
      currentBalance: 1_000_000,
      cashBalance: undefined,
      save: jest.fn().mockResolvedValue(undefined),
    };
    positionModel.find.mockReturnValue({
      lean: jest.fn().mockResolvedValue([
        { quantity: 10, currentPrice: 10_000 },
        { quantity: 5, currentPrice: 20_000 },
      ]),
    });

    const cash = await service['ensureInvestmentCashBalance'](
      legacyHolding as never,
    );

    expect(cash).toBe(800_000);
    expect(legacyHolding.cashBalance).toBe(800_000);
    expect(legacyHolding.save).toHaveBeenCalled();
  });

  it('replays purchases to calculate the weighted average cost', async () => {
    const instrumentId = new Types.ObjectId();
    transactionModel.find.mockReturnValue({
      sort: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue([
          {
            _id: new Types.ObjectId(),
            instrumentId,
            type: InvestmentTransactionType.BUY,
            quantity: 10,
            unitPrice: 100,
            fees: 0,
            occurredAt: new Date('2026-01-01'),
          },
          {
            _id: new Types.ObjectId(),
            instrumentId,
            type: InvestmentTransactionType.BUY,
            quantity: 15,
            unitPrice: 110,
            fees: 0,
            occurredAt: new Date('2026-02-01'),
          },
        ]),
      }),
    });

    const state = await service['replayInstrumentTransactions'](
      holdingId,
      instrumentId.toString(),
    );

    expect(state).toEqual({ quantity: 25, averageCost: 106 });
  });

  it('rejects a correction that creates a sale without enough units', async () => {
    const instrumentId = new Types.ObjectId();
    transactionModel.find.mockReturnValue({
      sort: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue([
          {
            _id: new Types.ObjectId(),
            instrumentId,
            type: InvestmentTransactionType.BUY,
            quantity: 10,
            unitPrice: 100,
            occurredAt: new Date('2026-01-01'),
          },
          {
            _id: new Types.ObjectId(),
            instrumentId,
            type: InvestmentTransactionType.SELL,
            quantity: 11,
            unitPrice: 120,
            occurredAt: new Date('2026-02-01'),
          },
        ]),
      }),
    });

    await expect(
      service['replayInstrumentTransactions'](
        holdingId,
        instrumentId.toString(),
      ),
    ).rejects.toThrow('venta sin unidades suficientes');
  });
});
