import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { BadRequestException } from '@nestjs/common';
import { Types } from 'mongoose';
import { ExpensesService } from './expenses.service';
import { Expense, ExpenseStatus, PaymentMethod } from './expense.schema';
import { Budget } from '../budgets/budget.schema';
import { Participant } from '../participants/schemas/participant.schema';
import { BoardsService } from '../trips/trips.service';
import { BoardType } from '../trips/board.schema';
import { CategoriesService } from '../categories/categories.service';
import { PaymentMethodsService } from '../payment-methods/payment-methods.service';
import { FxService } from '../fx/fx.service';

describe('ExpensesService category and payment methods', () => {
  let service: ExpensesService;

  const boardId = new Types.ObjectId();
  const expenseId = new Types.ObjectId();
  const participantId = new Types.ObjectId();
  const categoryId = new Types.ObjectId();
  const paymentMethodId = new Types.ObjectId();
  const userId = new Types.ObjectId().toString();

  const expenseModel = {
    find: jest.fn(),
    findById: jest.fn(),
    updateOne: jest.fn(),
    prototype: { save: jest.fn() },
  };

  const budgetModel = {
    findById: jest.fn(),
    findByIdAndUpdate: jest.fn(),
  };

  const participantModel = {
    findOne: jest.fn(),
    find: jest.fn(),
  };

  const boardsService = {
    findByIdOrFail: jest.fn(),
    assertTravelFeatures: jest.fn(),
    isTravelBoard: jest.fn(),
  };

  const categoriesService = {
    findOne: jest.fn(),
  };

  const paymentMethodsService = {
    findAvailableForBoard: jest.fn(),
  };

  const fxService = {
    resolveSnapshot: jest.fn().mockResolvedValue({
      fxRateToBoardCurrency: 1,
      fxCapturedAt: new Date(),
    }),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ExpensesService,
        { provide: getModelToken(Expense.name), useValue: expenseModel },
        { provide: getModelToken(Budget.name), useValue: budgetModel },
        {
          provide: getModelToken(Participant.name),
          useValue: participantModel,
        },
        { provide: BoardsService, useValue: boardsService },
        { provide: CategoriesService, useValue: categoriesService },
        { provide: PaymentMethodsService, useValue: paymentMethodsService },
        { provide: FxService, useValue: fxService },
      ],
    }).compile();

    service = module.get(ExpensesService);
  });

  describe('create', () => {
    it('should reject categoryId from another board', async () => {
      boardsService.findByIdOrFail.mockResolvedValue({
        _id: boardId,
        type: BoardType.EVERYDAY,
      });
      participantModel.findOne.mockResolvedValue({ _id: participantId });
      categoriesService.findOne.mockResolvedValue({
        _id: categoryId,
        tripId: new Types.ObjectId(),
        isActive: true,
      });

      await expect(
        service.create(
          {
            boardId: boardId.toString(),
            amount: 25,
            description: 'Almuerzo',
            categoryId: categoryId.toString(),
          },
          userId,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('should reject paymentMethodId not available for board', async () => {
      boardsService.findByIdOrFail.mockResolvedValue({
        _id: boardId,
        type: BoardType.EVERYDAY,
      });
      participantModel.findOne.mockResolvedValue({ _id: participantId });
      paymentMethodsService.findAvailableForBoard.mockResolvedValue([]);

      await expect(
        service.create(
          {
            boardId: boardId.toString(),
            amount: 25,
            description: 'Almuerzo',
            paymentMethodId: paymentMethodId.toString(),
          },
          userId,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('findAll', () => {
    it('should apply categoryId and date filters', async () => {
      participantModel.findOne.mockResolvedValue({ _id: participantId });

      const leanMock = jest.fn().mockResolvedValue([]);
      const sortMock = jest.fn().mockReturnValue({ lean: leanMock });
      const populateChain = {
        populate: jest.fn().mockReturnThis(),
        sort: sortMock,
      };

      expenseModel.find.mockReturnValue(populateChain);

      await service.findAll(boardId.toString(), userId, {
        categoryId: categoryId.toString(),
        from: '2026-07-01',
        to: '2026-07-31',
      });

      expect(expenseModel.find).toHaveBeenCalledWith({
        tripId: boardId,
        categoryId: categoryId,
        expenseDate: {
          $gte: new Date('2026-07-01'),
          $lt: new Date('2026-08-01'),
        },
      });
    });

    it('should match paymentMethodId filter on legacy cardId field', async () => {
      participantModel.findOne.mockResolvedValue({ _id: participantId });

      const leanMock = jest.fn().mockResolvedValue([]);
      const sortMock = jest.fn().mockReturnValue({ lean: leanMock });
      const populateChain = {
        populate: jest.fn().mockReturnThis(),
        sort: sortMock,
      };

      expenseModel.find.mockReturnValue(populateChain);

      await service.findAll(boardId.toString(), userId, {
        paymentMethodId: paymentMethodId.toString(),
      });

      expect(expenseModel.find).toHaveBeenCalledWith({
        tripId: boardId,
        $or: [
          { paymentMethodId: paymentMethodId },
          { cardId: paymentMethodId },
        ],
      });
    });
  });

  describe('update', () => {
    it('should preserve legacy cardId when payment method is not in the patch', async () => {
      const legacyCardId = new Types.ObjectId();
      const expenseDoc = {
        _id: expenseId,
        tripId: boardId,
        amount: 10,
        status: ExpenseStatus.PAID,
        isDivisible: false,
        splits: [],
        paymentMethod: PaymentMethod.CARD,
        cardId: legacyCardId,
        paymentMethodId: undefined,
        paidByParticipantId: participantId,
        expenseDate: new Date('2026-07-15'),
        save: jest.fn().mockResolvedValue({
          _id: expenseId,
          tripId: boardId,
          cardId: legacyCardId,
          paymentMethodId: legacyCardId,
        }),
      };

      expenseModel.findById.mockResolvedValueOnce(expenseDoc).mockReturnValue({
        populate: jest.fn().mockReturnThis(),
        lean: jest.fn().mockResolvedValue({
          _id: expenseId,
          tripId: boardId,
          cardId: legacyCardId,
          paymentMethodId: legacyCardId,
          paidByParticipantId: participantId,
          createdBy: new Types.ObjectId(userId),
          isDivisible: false,
          status: ExpenseStatus.PAID,
          expenseDate: new Date('2026-07-15'),
          createdAt: new Date(),
          updatedAt: new Date(),
        }),
      });

      boardsService.findByIdOrFail.mockResolvedValue({
        _id: boardId,
        type: BoardType.EVERYDAY,
      });
      participantModel.findOne.mockResolvedValue({ _id: participantId });

      await service.update(
        expenseId.toString(),
        { description: 'Descripción actualizada' },
        userId,
      );

      expect(expenseDoc.cardId).toEqual(legacyCardId);
      expect(expenseDoc.paymentMethodId).toEqual(legacyCardId);
      expect(expenseDoc.save).toHaveBeenCalled();
    });
  });
});
