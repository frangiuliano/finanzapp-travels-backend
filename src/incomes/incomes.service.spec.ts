import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import {
  ForbiddenException,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { Types } from 'mongoose';
import { IncomesService } from './incomes.service';
import { Income } from './income.schema';
import { Expense } from '../expenses/expense.schema';
import { ParticipantsService } from '../participants/participants.service';
import { BoardsService } from '../trips/trips.service';
import { RecurringMaterializationService } from '../recurring-materialization/recurring-materialization.service';
import { PaymentMethodsService } from '../payment-methods/payment-methods.service';

describe('IncomesService', () => {
  let service: IncomesService;

  const boardId = new Types.ObjectId();
  const incomeId = new Types.ObjectId();
  const userId = new Types.ObjectId().toString();

  const saveMock = jest.fn();
  const incomeQuery = {
    find: jest.fn(),
    findById: jest.fn(),
    findByIdAndDelete: jest.fn(),
  };

  const IncomeModelMock = jest.fn().mockImplementation((data: object) => ({
    ...data,
    save: saveMock,
  }));
  Object.assign(IncomeModelMock, incomeQuery);

  const expenseModel = {
    find: jest.fn(),
  };

  const participantsService = {
    ensureParticipantAccess: jest.fn(),
  };

  const boardsService = {
    findByIdOrFail: jest.fn(),
    findExpenseScopeContext: jest.fn(),
  };

  const materializationService = {
    skipIncomeOccurrence: jest.fn(),
  };

  const paymentMethodsService = {
    findAvailableForBoard: jest.fn(),
  };

  const mockIncomeDoc = {
    _id: incomeId,
    tripId: boardId,
    amount: 1000,
    currency: 'ARS',
    label: 'Sueldo',
    incomeDate: new Date('2026-07-15'),
    save: saveMock,
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    boardsService.findExpenseScopeContext.mockResolvedValue([
      { board: { _id: boardId }, participantId: new Types.ObjectId() },
    ]);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        IncomesService,
        { provide: getModelToken(Income.name), useValue: IncomeModelMock },
        { provide: getModelToken(Expense.name), useValue: expenseModel },
        { provide: ParticipantsService, useValue: participantsService },
        { provide: BoardsService, useValue: boardsService },
        {
          provide: RecurringMaterializationService,
          useValue: materializationService,
        },
        {
          provide: PaymentMethodsService,
          useValue: paymentMethodsService,
        },
      ],
    }).compile();

    service = module.get(IncomesService);
    participantsService.ensureParticipantAccess.mockResolvedValue(undefined);
    boardsService.findByIdOrFail.mockResolvedValue({
      _id: boardId,
      baseCurrency: 'ARS',
    });
    paymentMethodsService.findAvailableForBoard.mockResolvedValue([]);
  });

  describe('create', () => {
    it('should create income with board default currency', async () => {
      saveMock.mockResolvedValue({
        _id: incomeId,
        amount: 1000,
        currency: 'ARS',
        label: 'Sueldo',
      });

      const result = await service.create(
        {
          boardId: boardId.toString(),
          amount: 1000,
          label: 'Sueldo',
        },
        userId,
      );

      expect(participantsService.ensureParticipantAccess).toHaveBeenCalledWith(
        boardId.toString(),
        userId,
      );
      expect(IncomeModelMock).toHaveBeenCalledWith(
        expect.objectContaining({
          amount: 1000,
          currency: 'ARS',
          label: 'Sueldo',
        }),
      );
      expect(saveMock).toHaveBeenCalled();
      expect(result.currency).toBe('ARS');
    });

    it('should require boardId', async () => {
      await expect(
        service.create({ amount: 100, label: 'Test' } as never, userId),
      ).rejects.toThrow(BadRequestException);
    });

    it('should create a future one-time income as pending', async () => {
      saveMock.mockResolvedValue({ _id: incomeId });

      await service.create(
        {
          boardId: boardId.toString(),
          amount: 500,
          label: 'Aguinaldo',
          incomeDate: '2099-12-15',
        },
        userId,
      );

      expect(IncomeModelMock).toHaveBeenCalledWith(
        expect.objectContaining({
          label: 'Aguinaldo',
          status: 'pending',
          incomeDate: new Date('2099-12-15'),
        }),
      );
    });
  });

  describe('findAllByBoard', () => {
    it('should require participant access', async () => {
      participantsService.ensureParticipantAccess.mockRejectedValue(
        new ForbiddenException('No tienes acceso a este viaje'),
      );

      await expect(
        service.findAllByBoard(boardId.toString(), userId),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should return incomes sorted by date', async () => {
      const incomes = [{ _id: incomeId, label: 'Sueldo', amount: 1000 }];
      const sortMock = jest
        .fn()
        .mockReturnValue({ lean: jest.fn().mockResolvedValue(incomes) });
      incomeQuery.find.mockReturnValue({ sort: sortMock });

      const result = await service.findAllByBoard(boardId.toString(), userId);

      expect(incomeQuery.find).toHaveBeenCalledWith({
        tripId: boardId,
      });
      expect(result).toEqual(incomes);
    });
  });

  describe('findOne', () => {
    it('should throw when income not found', async () => {
      incomeQuery.findById.mockReturnValue({
        lean: jest.fn().mockResolvedValue(null),
      });

      await expect(
        service.findOne(incomeId.toString(), userId),
      ).rejects.toThrow(NotFoundException);
    });

    it('should enforce board access', async () => {
      incomeQuery.findById.mockReturnValue({
        lean: jest.fn().mockResolvedValue({
          _id: incomeId,
          tripId: boardId,
          label: 'Sueldo',
        }),
      });

      const result = await service.findOne(incomeId.toString(), userId);

      expect(participantsService.ensureParticipantAccess).toHaveBeenCalledWith(
        boardId.toString(),
        userId,
      );
      expect(result.label).toBe('Sueldo');
    });
  });

  describe('update', () => {
    it('should throw when income not found', async () => {
      incomeQuery.findById.mockResolvedValue(null);

      await expect(
        service.update(incomeId.toString(), { label: 'Nuevo' }, userId),
      ).rejects.toThrow(NotFoundException);
    });

    it('should update allowed fields', async () => {
      const doc = { ...mockIncomeDoc };
      incomeQuery.findById.mockResolvedValue(doc);
      saveMock.mockResolvedValue({ ...doc, label: 'Bono' });

      const result = await service.update(
        incomeId.toString(),
        { label: 'Bono', amount: 500 },
        userId,
      );

      expect(doc.label).toBe('Bono');
      expect(doc.amount).toBe(500);
      expect(saveMock).toHaveBeenCalled();
      expect(result.label).toBe('Bono');
    });
  });

  describe('remove', () => {
    it('should delete income after access check', async () => {
      incomeQuery.findById.mockResolvedValue(mockIncomeDoc);
      incomeQuery.findByIdAndDelete.mockResolvedValue(mockIncomeDoc);

      await service.remove(incomeId.toString(), userId);

      expect(incomeQuery.findByIdAndDelete).toHaveBeenCalledWith(
        incomeId.toString(),
      );
    });
  });

  describe('getMonthlySummary', () => {
    it('should compute remaining = incomes - expenses in board currency', async () => {
      incomeQuery.find.mockReturnValue({
        lean: jest.fn().mockResolvedValue([
          { amount: 5000, currency: 'ARS' },
          { amount: 100, currency: 'USD' },
        ]),
      });
      expenseModel.find.mockReturnValue({
        lean: jest.fn().mockResolvedValue([
          { amount: 1200, currency: 'ARS' },
          { amount: 50, currency: 'USD' },
        ]),
      });

      const summary = await service.getMonthlySummary(
        boardId.toString(),
        '2026-07',
        userId,
      );

      expect(summary.totalIncomes).toBe(5000);
      expect(summary.totalExpenses).toBe(1200);
      expect(summary.remaining).toBe(3800);
      expect(summary.currency).toBe('ARS');
      expect(summary.yearMonth).toBe('2026-07');
      expect(summary.excludedDueToCurrencyMismatch).toEqual({
        incomes: 1,
        expenses: 1,
      });
    });

    it('should reject invalid yearMonth', async () => {
      await expect(
        service.getMonthlySummary(boardId.toString(), '2026-13', userId),
      ).rejects.toThrow(BadRequestException);
    });
  });
});
