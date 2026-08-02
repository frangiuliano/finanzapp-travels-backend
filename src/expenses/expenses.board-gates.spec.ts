import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { BadRequestException } from '@nestjs/common';
import { Types } from 'mongoose';
import { ExpensesService } from './expenses.service';
import { Expense, ExpenseStatus } from './expense.schema';
import { Budget } from '../budgets/budget.schema';
import { Participant } from '../participants/schemas/participant.schema';
import { BoardsService } from '../trips/trips.service';
import { BoardType } from '../trips/board.schema';
import { CategoriesService } from '../categories/categories.service';
import { PaymentMethodsService } from '../payment-methods/payment-methods.service';
import { FxService } from '../fx/fx.service';
import { ExpenseFxResolver } from '../fx/expense-fx.resolver';
import { RecurringMaterializationService } from '../recurring-materialization/recurring-materialization.service';

describe('ExpensesService board gates', () => {
  let service: ExpensesService;

  const boardId = new Types.ObjectId();
  const expenseId = new Types.ObjectId();
  const participantId = new Types.ObjectId();
  const budgetId = new Types.ObjectId();
  const userId = new Types.ObjectId().toString();

  const expenseModel = {
    findById: jest.fn(),
  };

  const budgetModel = {
    findById: jest.fn(),
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

  const expenseFxResolver = {
    buildFxOnCreate: jest.fn().mockReturnValue(null),
    resolveSpotSnapshot: jest.fn().mockResolvedValue({
      fxRateToBoardCurrency: 1,
      fxCapturedAt: new Date(),
    }),
    resolveDisplayFx: jest.fn().mockResolvedValue(null),
    getAmountInBoardCurrency: jest.fn().mockResolvedValue(null),
  };

  const materializationService = {
    skipExpenseOccurrence: jest.fn(),
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
        { provide: ExpenseFxResolver, useValue: expenseFxResolver },
        {
          provide: RecurringMaterializationService,
          useValue: materializationService,
        },
      ],
    }).compile();

    service = module.get(ExpensesService);
  });

  describe('create', () => {
    it('should reject budgetId on everyday boards', async () => {
      boardsService.findByIdOrFail.mockResolvedValue({
        _id: boardId,
        type: BoardType.EVERYDAY,
      });
      participantModel.findOne.mockResolvedValue({ _id: participantId });

      await expect(
        service.create(
          {
            boardId: boardId.toString(),
            amount: 10,
            description: 'Cafe',
            budgetId: budgetId.toString(),
          },
          userId,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('should allow pending status on everyday boards', async () => {
      boardsService.findByIdOrFail.mockResolvedValue({
        _id: boardId,
        type: BoardType.EVERYDAY,
        baseCurrency: 'USD',
      });
      participantModel.findOne.mockResolvedValue({ _id: participantId });
      participantModel.find.mockResolvedValue([{ _id: participantId }]);
      paymentMethodsService.findAvailableForBoard.mockResolvedValue([]);

      const saved = {
        _id: expenseId,
        description: 'Netflix',
        amount: 10,
        currency: 'USD',
      };
      const expenseInstance = {
        save: jest.fn().mockResolvedValue(saved),
      };
      const ExpenseModelCtor = jest
        .fn()
        .mockImplementation(() => expenseInstance);
      Object.assign(ExpenseModelCtor, expenseModel);
      expenseModel.findById.mockReturnValue({
        populate: jest.fn().mockReturnThis(),
        lean: jest.fn().mockResolvedValue({
          ...saved,
          tripId: boardId,
          paidByParticipantId: participantId,
          createdBy: new Types.ObjectId(userId),
          isDivisible: false,
          status: ExpenseStatus.PENDING,
          expenseDate: new Date(),
          createdAt: new Date(),
          updatedAt: new Date(),
        }),
      });

      const module: TestingModule = await Test.createTestingModule({
        providers: [
          ExpensesService,
          { provide: getModelToken(Expense.name), useValue: ExpenseModelCtor },
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

      const expensesService = module.get(ExpensesService);
      await expensesService.create(
        {
          boardId: boardId.toString(),
          amount: 10,
          description: 'Netflix',
          status: ExpenseStatus.PENDING,
        },
        userId,
      );

      expect(ExpenseModelCtor).toHaveBeenCalledWith(
        expect.objectContaining({
          status: ExpenseStatus.PENDING,
        }),
      );
    });

    it('should create everyday expense without paidBy (defaults to creator)', async () => {
      boardsService.findByIdOrFail.mockResolvedValue({
        _id: boardId,
        type: BoardType.EVERYDAY,
        baseCurrency: 'USD',
      });
      participantModel.findOne
        .mockResolvedValueOnce({ _id: participantId })
        .mockResolvedValueOnce({ _id: participantId });
      participantModel.find.mockResolvedValue([{ _id: participantId }]);

      const saved = {
        _id: expenseId,
        description: 'Cafe',
        amount: 10,
        currency: 'USD',
      };
      const expenseInstance = {
        save: jest.fn().mockResolvedValue(saved),
      };
      const ExpenseModelCtor = jest
        .fn()
        .mockImplementation(() => expenseInstance);
      Object.assign(ExpenseModelCtor, expenseModel);
      expenseModel.findById.mockReturnValue({
        populate: jest.fn().mockReturnThis(),
        lean: jest.fn().mockResolvedValue({
          ...saved,
          tripId: boardId,
          paidByParticipantId: participantId,
          createdBy: new Types.ObjectId(userId),
          isDivisible: false,
          status: ExpenseStatus.PAID,
          expenseDate: new Date(),
          createdAt: new Date(),
          updatedAt: new Date(),
        }),
      });

      const module: TestingModule = await Test.createTestingModule({
        providers: [
          ExpensesService,
          { provide: getModelToken(Expense.name), useValue: ExpenseModelCtor },
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

      const expensesService = module.get(ExpensesService);
      const result = await expensesService.create(
        {
          boardId: boardId.toString(),
          amount: 10,
          description: 'Cafe',
        },
        userId,
      );

      expect(ExpenseModelCtor).toHaveBeenCalledWith(
        expect.objectContaining({
          paidByParticipantId: participantId,
          isDivisible: false,
          status: ExpenseStatus.PAID,
        }),
      );
      expect(result).toBeDefined();
    });
  });

  describe('update', () => {
    const baseExpense = {
      _id: expenseId,
      tripId: boardId,
      amount: 10,
      status: ExpenseStatus.PAID,
      isDivisible: false,
      splits: [],
      budgetId: undefined,
      save: jest.fn(),
    };

    it('should reject attaching budgetId on everyday boards', async () => {
      expenseModel.findById.mockResolvedValue({ ...baseExpense });
      boardsService.findByIdOrFail.mockResolvedValue({
        _id: boardId,
        type: BoardType.EVERYDAY,
      });

      await expect(
        service.update(
          expenseId.toString(),
          { budgetId: budgetId.toString() },
          userId,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('should reject status changes on everyday boards (settle bypass)', async () => {
      expenseModel.findById.mockResolvedValue({
        ...baseExpense,
        status: ExpenseStatus.PENDING,
      });
      boardsService.findByIdOrFail.mockResolvedValue({
        _id: boardId,
        type: BoardType.EVERYDAY,
      });

      await expect(
        service.update(
          expenseId.toString(),
          { status: ExpenseStatus.PAID },
          userId,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('should reject splits on everyday boards', async () => {
      expenseModel.findById.mockResolvedValue({ ...baseExpense });
      boardsService.findByIdOrFail.mockResolvedValue({
        _id: boardId,
        type: BoardType.EVERYDAY,
      });

      await expect(
        service.update(
          expenseId.toString(),
          {
            isDivisible: true,
            splits: [{ participantId: participantId.toString(), amount: 10 }],
          },
          userId,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('settleExpense', () => {
    it('should settle pending recurring expense on everyday boards', async () => {
      const pendingExpense = {
        _id: expenseId,
        tripId: boardId,
        status: ExpenseStatus.PENDING,
        save: jest.fn().mockImplementation(function (this: {
          status: ExpenseStatus;
        }) {
          this.status = ExpenseStatus.PAID;
          return Promise.resolve(this);
        }),
      };
      expenseModel.findById
        .mockResolvedValueOnce(pendingExpense)
        .mockReturnValue({
          populate: jest.fn().mockReturnThis(),
          lean: jest.fn().mockResolvedValue({
            _id: expenseId,
            tripId: boardId,
            status: ExpenseStatus.PAID,
            paidByParticipantId: participantId,
            createdBy: new Types.ObjectId(userId),
            isDivisible: false,
            expenseDate: new Date(),
            createdAt: new Date(),
            updatedAt: new Date(),
          }),
        });
      participantModel.findOne.mockResolvedValue({ _id: participantId });

      const result = await service.settleExpense(expenseId.toString(), userId);

      expect(pendingExpense.save).toHaveBeenCalled();
      expect(result.status).toBe(ExpenseStatus.PAID);
    });
  });
});
