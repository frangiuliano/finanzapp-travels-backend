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
import { ExpenseFxResolver } from '../fx/expense-fx.resolver';
import { RecurringMaterializationService } from '../recurring-materialization/recurring-materialization.service';

describe('ExpensesService category and payment methods', () => {
  let service: ExpensesService;

  const boardId = new Types.ObjectId();
  const expenseId = new Types.ObjectId();
  const participantId = new Types.ObjectId();
  const categoryId = new Types.ObjectId();
  const paymentMethodId = new Types.ObjectId();
  const userId = new Types.ObjectId().toString();

  const expenseModel = {
    collection: {
      updateMany: jest.fn(),
    },
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
    findExpenseScopeContext: jest.fn(),
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

  const expenseFxResolver = {
    buildFxOnCreate: jest.fn().mockReturnValue(null),
    resolveSpotSnapshot: jest.fn().mockResolvedValue({
      fxRateToBoardCurrency: 1,
      fxCapturedAt: new Date(),
    }),
    resolveDisplayFx: jest.fn().mockResolvedValue(null),
    getAmountInBoardCurrency: jest.fn().mockResolvedValue(null),
  };

  const materializationService = { skipExpenseOccurrence: jest.fn() };

  beforeEach(async () => {
    jest.clearAllMocks();
    expenseModel.collection.updateMany.mockResolvedValue({ modifiedCount: 0 });
    boardsService.findExpenseScopeContext.mockResolvedValue([
      {
        board: { _id: boardId, name: 'Hogar', type: BoardType.EVERYDAY },
        participantId,
      },
    ]);

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
        { provide: ExpenseFxResolver, useValue: expenseFxResolver },
        {
          provide: RecurringMaterializationService,
          useValue: materializationService,
        },
      ],
    }).compile();

    service = module.get(ExpensesService);
  });

  describe('onModuleInit', () => {
    it('backfills the explicit payment month from the legacy cycle label, then falls back to expenseDate for the rest', async () => {
      expenseModel.collection.updateMany.mockResolvedValue({
        modifiedCount: 2,
      });
      expenseModel.find.mockReturnValue({
        select: jest.fn().mockReturnValue({
          lean: jest.fn().mockResolvedValue([]),
        }),
      });

      await service.onModuleInit();

      expect(expenseModel.collection.updateMany).toHaveBeenNthCalledWith(
        1,
        {
          paymentYearMonth: { $exists: false },
          billingCycleLabel: { $type: 'string' },
        },
        [{ $set: { paymentYearMonth: '$billingCycleLabel' } }],
      );
      expect(expenseModel.collection.updateMany).toHaveBeenNthCalledWith(
        2,
        { paymentYearMonth: { $exists: false } },
        [
          {
            $set: {
              paymentYearMonth: {
                $dateToString: { format: '%Y-%m', date: '$expenseDate' },
              },
            },
          },
        ],
      );
    });
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
            paymentYearMonth: '2026-07',
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
            paymentYearMonth: '2026-07',
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
        tripId: { $in: [boardId] },
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
        tripId: { $in: [boardId] },
        $or: [
          { paymentMethodId: paymentMethodId },
          { cardId: paymentMethodId },
        ],
      });
    });

    it('should find expenses by their assigned payment month', async () => {
      const leanMock = jest.fn().mockResolvedValue([]);
      const sortMock = jest.fn().mockReturnValue({ lean: leanMock });
      expenseModel.find.mockReturnValue({
        populate: jest.fn().mockReturnThis(),
        sort: sortMock,
      });

      await service.findAll(boardId.toString(), userId, {
        paymentYearMonth: '2026-10',
      });

      expect(expenseModel.find).toHaveBeenCalledWith({
        tripId: { $in: [boardId] },
        paymentYearMonth: '2026-10',
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

    it('marks amount/description as overridden when they actually change on an installment cuota', async () => {
      const installmentPlanId = new Types.ObjectId();
      const expenseDoc = {
        _id: expenseId,
        tripId: boardId,
        description: 'Cuota original',
        amount: 1000,
        currency: 'ARS',
        status: ExpenseStatus.PENDING,
        isDivisible: false,
        splits: [],
        paymentMethod: PaymentMethod.CARD,
        paidByParticipantId: participantId,
        expenseDate: new Date('2026-09-10'),
        installmentPlanId,
        installmentNumber: 2,
        overriddenFields: [],
        save: jest.fn().mockImplementation(function (this: unknown) {
          return Promise.resolve(this);
        }),
      };

      expenseModel.findById.mockResolvedValueOnce(expenseDoc).mockReturnValue({
        populate: jest.fn().mockReturnThis(),
        lean: jest.fn().mockResolvedValue({
          ...expenseDoc,
          createdBy: new Types.ObjectId(userId),
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
        { amount: 1500, description: 'Corregí el monto a mano' },
        userId,
      );

      expect(expenseDoc.overriddenFields).toEqual(
        expect.arrayContaining(['amount', 'description']),
      );
    });

    it('does not mark fields as overridden when the same value is resent unchanged', async () => {
      const installmentPlanId = new Types.ObjectId();
      const expenseDoc = {
        _id: expenseId,
        tripId: boardId,
        description: 'Cuota original',
        amount: 1000,
        currency: 'ARS',
        status: ExpenseStatus.PENDING,
        isDivisible: false,
        splits: [],
        paymentMethod: PaymentMethod.CARD,
        paidByParticipantId: participantId,
        expenseDate: new Date('2026-09-10'),
        installmentPlanId,
        installmentNumber: 2,
        overriddenFields: [],
        save: jest.fn().mockImplementation(function (this: unknown) {
          return Promise.resolve(this);
        }),
      };

      expenseModel.findById.mockResolvedValueOnce(expenseDoc).mockReturnValue({
        populate: jest.fn().mockReturnThis(),
        lean: jest.fn().mockResolvedValue({
          ...expenseDoc,
          createdBy: new Types.ObjectId(userId),
          createdAt: new Date(),
          updatedAt: new Date(),
        }),
      });
      boardsService.findByIdOrFail.mockResolvedValue({
        _id: boardId,
        type: BoardType.EVERYDAY,
      });
      participantModel.findOne.mockResolvedValue({ _id: participantId });

      // The quick-expense-form always resends amount/description, even
      // when the user didn't touch them — only a real change should count.
      await service.update(
        expenseId.toString(),
        { amount: 1000, description: 'Cuota original' },
        userId,
      );

      expect(expenseDoc.overriddenFields).toEqual([]);
    });
  });
});
