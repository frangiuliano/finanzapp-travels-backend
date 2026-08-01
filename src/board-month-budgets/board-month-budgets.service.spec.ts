import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import {
  ForbiddenException,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { Types } from 'mongoose';
import { BoardMonthBudgetsService } from './board-month-budgets.service';
import { BoardMonthBudget } from './board-month-budget.schema';
import { Expense } from '../expenses/expense.schema';
import { ParticipantsService } from '../participants/participants.service';
import { BoardsService } from '../trips/trips.service';
import { CategoriesService } from '../categories/categories.service';

describe('BoardMonthBudgetsService', () => {
  let service: BoardMonthBudgetsService;

  const boardId = new Types.ObjectId();
  const categoryId = new Types.ObjectId();
  const budgetId = new Types.ObjectId();
  const userId = new Types.ObjectId().toString();

  const saveMock = jest.fn();
  const budgetQuery = {
    find: jest.fn(),
    findOne: jest.fn(),
    findById: jest.fn(),
    findByIdAndDelete: jest.fn(),
  };

  const BudgetModelMock = jest.fn().mockImplementation((data: object) => ({
    ...data,
    save: saveMock,
  }));
  Object.assign(BudgetModelMock, budgetQuery);

  const expenseModel = {
    find: jest.fn(),
  };

  const participantsService = {
    ensureParticipantAccess: jest.fn(),
  };

  const boardsService = {
    assertEverydayFeatures: jest.fn(),
    findByIdOrFail: jest.fn(),
  };

  const categoriesService = {
    findOne: jest.fn(),
  };

  const mockBudgetDoc = {
    _id: budgetId,
    tripId: boardId,
    categoryId,
    yearMonth: '2026-07',
    limit: 50000,
    currency: 'ARS',
    save: saveMock,
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BoardMonthBudgetsService,
        {
          provide: getModelToken(BoardMonthBudget.name),
          useValue: BudgetModelMock,
        },
        { provide: getModelToken(Expense.name), useValue: expenseModel },
        { provide: ParticipantsService, useValue: participantsService },
        { provide: BoardsService, useValue: boardsService },
        { provide: CategoriesService, useValue: categoriesService },
      ],
    }).compile();

    service = module.get(BoardMonthBudgetsService);
    participantsService.ensureParticipantAccess.mockResolvedValue(undefined);
    boardsService.assertEverydayFeatures.mockResolvedValue({
      _id: boardId,
      baseCurrency: 'ARS',
      type: 'everyday',
    });
    boardsService.findByIdOrFail.mockResolvedValue({
      _id: boardId,
      baseCurrency: 'ARS',
    });
    categoriesService.findOne.mockResolvedValue({
      _id: categoryId,
      tripId: boardId,
      name: 'Comida',
    });
    budgetQuery.findOne.mockResolvedValue(null);
  });

  describe('create', () => {
    it('should create a monthly budget for an everyday board', async () => {
      saveMock.mockResolvedValue({
        _id: budgetId,
        limit: 50000,
        yearMonth: '2026-07',
      });

      const result = await service.create(
        {
          boardId: boardId.toString(),
          categoryId: categoryId.toString(),
          yearMonth: '2026-07',
          limit: 50000,
        },
        userId,
      );

      expect(boardsService.assertEverydayFeatures).toHaveBeenCalledWith(
        boardId.toString(),
      );
      expect(categoriesService.findOne).toHaveBeenCalledWith(
        categoryId.toString(),
        userId,
      );
      expect(BudgetModelMock).toHaveBeenCalledWith(
        expect.objectContaining({
          limit: 50000,
          yearMonth: '2026-07',
          currency: 'ARS',
        }),
      );
      expect(saveMock).toHaveBeenCalled();
      expect(result.limit).toBe(50000);
    });

    it('should reject duplicate budget for same category and month', async () => {
      budgetQuery.findOne.mockResolvedValue({ _id: budgetId });

      await expect(
        service.create(
          {
            boardId: boardId.toString(),
            categoryId: categoryId.toString(),
            yearMonth: '2026-07',
            limit: 50000,
          },
          userId,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('should reject when category belongs to another board', async () => {
      categoriesService.findOne.mockResolvedValue({
        _id: categoryId,
        tripId: new Types.ObjectId(),
      });

      await expect(
        service.create(
          {
            boardId: boardId.toString(),
            categoryId: categoryId.toString(),
            yearMonth: '2026-07',
            limit: 50000,
          },
          userId,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('should reject create on travel boards', async () => {
      boardsService.assertEverydayFeatures.mockRejectedValue(
        new ForbiddenException(
          'Esta operación solo está disponible en tableros de tipo everyday',
        ),
      );

      await expect(
        service.create(
          {
            boardId: boardId.toString(),
            categoryId: categoryId.toString(),
            yearMonth: '2026-07',
            limit: 50000,
          },
          userId,
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('should require boardId', async () => {
      await expect(
        service.create(
          {
            categoryId: categoryId.toString(),
            yearMonth: '2026-07',
            limit: 50000,
          } as never,
          userId,
        ),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('getProgress', () => {
    it('should calculate spent and percentUsed from categorized expenses', async () => {
      const chain = {
        sort: jest.fn().mockReturnThis(),
        lean: jest.fn().mockResolvedValue([
          {
            _id: budgetId,
            tripId: boardId,
            categoryId,
            yearMonth: '2026-07',
            limit: 10000,
            currency: 'ARS',
          },
        ]),
      };
      budgetQuery.find.mockReturnValue(chain);

      expenseModel.find.mockReturnValue({
        lean: jest.fn().mockResolvedValue([
          {
            categoryId,
            amount: 2500,
            currency: 'ARS',
            expenseDate: new Date('2026-07-10'),
          },
          {
            categoryId,
            amount: 1500,
            currency: 'ARS',
            expenseDate: new Date('2026-07-20'),
          },
          {
            categoryId,
            amount: 500,
            currency: 'USD',
            expenseDate: new Date('2026-07-21'),
          },
        ]),
      });

      const progress = await service.getProgress(
        boardId.toString(),
        '2026-07',
        userId,
      );

      expect(progress).toHaveLength(1);
      expect(progress[0].spent).toBe(4000);
      expect(progress[0].limit).toBe(10000);
      expect(progress[0].remaining).toBe(6000);
      expect(progress[0].percentUsed).toBe(40);
    });

    it('should return empty list when no budgets exist', async () => {
      const chain = {
        sort: jest.fn().mockReturnThis(),
        lean: jest.fn().mockResolvedValue([]),
      };
      budgetQuery.find.mockReturnValue(chain);

      const progress = await service.getProgress(
        boardId.toString(),
        '2026-07',
        userId,
      );

      expect(progress).toEqual([]);
      expect(expenseModel.find).not.toHaveBeenCalled();
    });
  });

  describe('findOne', () => {
    it('should return progress for a single budget', async () => {
      budgetQuery.findById.mockReturnValue({
        lean: jest.fn().mockResolvedValue({
          _id: budgetId,
          tripId: boardId,
          categoryId,
          yearMonth: '2026-07',
          limit: 20000,
          currency: 'ARS',
        }),
      });

      expenseModel.find.mockReturnValue({
        lean: jest.fn().mockResolvedValue([
          {
            categoryId,
            amount: 5000,
            currency: 'ARS',
            expenseDate: new Date('2026-07-05'),
          },
        ]),
      });

      const result = await service.findOne(budgetId.toString(), userId);

      expect(result.spent).toBe(5000);
      expect(result.percentUsed).toBe(25);
    });

    it('should throw when budget not found', async () => {
      budgetQuery.findById.mockReturnValue({
        lean: jest.fn().mockResolvedValue(null),
      });

      await expect(
        service.findOne(budgetId.toString(), userId),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('update', () => {
    it('should update limit without clearing other fields', async () => {
      budgetQuery.findById.mockResolvedValue(mockBudgetDoc);
      saveMock.mockResolvedValue({ ...mockBudgetDoc, limit: 75000 });

      const result = await service.update(
        budgetId.toString(),
        { limit: 75000 },
        userId,
      );

      expect(mockBudgetDoc.limit).toBe(75000);
      expect(saveMock).toHaveBeenCalled();
      expect(result.limit).toBe(75000);
    });

    it('should reject update on travel boards', async () => {
      budgetQuery.findById.mockResolvedValue(mockBudgetDoc);
      boardsService.assertEverydayFeatures.mockRejectedValue(
        new ForbiddenException('everyday only'),
      );

      await expect(
        service.update(budgetId.toString(), { limit: 100 }, userId),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  describe('remove', () => {
    it('should delete budget after access checks', async () => {
      budgetQuery.findById.mockResolvedValue(mockBudgetDoc);
      budgetQuery.findByIdAndDelete.mockResolvedValue(mockBudgetDoc);

      await service.remove(budgetId.toString(), userId);

      expect(budgetQuery.findByIdAndDelete).toHaveBeenCalledWith(
        budgetId.toString(),
      );
    });
  });
});
