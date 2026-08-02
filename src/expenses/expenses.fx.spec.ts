import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { BadRequestException } from '@nestjs/common';
import { Types } from 'mongoose';
import { ExpensesService } from './expenses.service';
import {
  Expense,
  ExpenseFxPolicy,
  ExpenseFxPurpose,
  ExpenseStatus,
} from './expense.schema';
import { Budget } from '../budgets/budget.schema';
import { Participant } from '../participants/schemas/participant.schema';
import { BoardsService } from '../trips/trips.service';
import { BoardType } from '../trips/board.schema';
import { CategoriesService } from '../categories/categories.service';
import { PaymentMethodsService } from '../payment-methods/payment-methods.service';
import { FxService } from '../fx/fx.service';
import { ExpenseFxResolver } from '../fx/expense-fx.resolver';
import { RecurringMaterializationService } from '../recurring-materialization/recurring-materialization.service';

describe('ExpensesService FX snapshot', () => {
  let service: ExpensesService;

  const boardId = new Types.ObjectId();
  const expenseId = new Types.ObjectId();
  const participantId = new Types.ObjectId();
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
  };

  const categoriesService = {
    findOne: jest.fn(),
  };

  const paymentMethodsService = {
    findAvailableForBoard: jest.fn(),
  };

  const fxService = {
    resolveSnapshot: jest.fn(),
  };

  const expenseFxResolver = {
    buildFxOnCreate: jest.fn(),
    resolveSpotSnapshot: jest.fn(),
    resolveDisplayFx: jest.fn(),
    getAmountInBoardCurrency: jest.fn(),
  };

  const materializationService = { skipExpenseOccurrence: jest.fn() };

  const baseProviders = [
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
  ];

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: baseProviders,
    }).compile();

    service = module.get(ExpensesService);
  });

  function mockSuccessfulCreate(savedOverrides: Record<string, unknown> = {}) {
    boardsService.findByIdOrFail.mockResolvedValue({
      _id: boardId,
      type: BoardType.EVERYDAY,
      baseCurrency: 'ARS',
    });
    participantModel.findOne
      .mockResolvedValueOnce({ _id: participantId })
      .mockResolvedValueOnce({ _id: participantId });
    participantModel.find.mockResolvedValue([{ _id: participantId }]);

    const capturedAt = new Date('2026-07-01T12:00:00.000Z');
    const saved = {
      _id: expenseId,
      description: 'Compra USD',
      amount: 10,
      currency: 'USD',
      fxRateToBoardCurrency: 1200,
      fxCapturedAt: capturedAt,
      fxPolicy: ExpenseFxPolicy.SPOT,
      fxPurpose: ExpenseFxPurpose.SETTLED,
      ...savedOverrides,
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

    expenseFxResolver.getAmountInBoardCurrency.mockResolvedValue(12000);
    expenseFxResolver.resolveDisplayFx.mockResolvedValue({
      rate: 1200,
      amountInBoardCurrency: 12000,
      purpose: ExpenseFxPurpose.SETTLED,
      isLive: false,
      boardCurrency: 'ARS',
    });

    return { ExpenseModelCtor, saved, capturedAt };
  }

  it('should persist FX snapshot when expense currency differs from board', async () => {
    const capturedAt = new Date('2026-07-01T12:00:00.000Z');
    expenseFxResolver.buildFxOnCreate.mockReturnValue({
      fxPolicy: ExpenseFxPolicy.SPOT,
      fxPurpose: ExpenseFxPurpose.SETTLED,
    });
    expenseFxResolver.resolveSpotSnapshot.mockResolvedValue({
      fxRateToBoardCurrency: 1200,
      fxCapturedAt: capturedAt,
    });

    const { ExpenseModelCtor } = mockSuccessfulCreate();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ...baseProviders.slice(0, 1),
        { provide: getModelToken(Expense.name), useValue: ExpenseModelCtor },
        ...baseProviders.slice(2),
      ],
    }).compile();

    const expensesService = module.get(ExpensesService);
    await expensesService.create(
      {
        boardId: boardId.toString(),
        amount: 10,
        currency: 'USD',
        description: 'Compra USD',
      },
      userId,
    );

    expect(expenseFxResolver.resolveSpotSnapshot).toHaveBeenCalledWith(
      'USD',
      'ARS',
      undefined,
    );
    expect(ExpenseModelCtor).toHaveBeenCalledWith(
      expect.objectContaining({
        currency: 'USD',
        fxRateToBoardCurrency: 1200,
        fxCapturedAt: capturedAt,
        fxPolicy: ExpenseFxPolicy.SPOT,
        fxPurpose: ExpenseFxPurpose.SETTLED,
      }),
    );
  });

  it('should pass fxRateOverride to spot snapshot resolver', async () => {
    expenseFxResolver.buildFxOnCreate.mockReturnValue({
      fxPolicy: ExpenseFxPolicy.SPOT,
      fxPurpose: ExpenseFxPurpose.SETTLED,
    });
    expenseFxResolver.resolveSpotSnapshot.mockResolvedValue({
      fxRateToBoardCurrency: 999,
      fxCapturedAt: new Date(),
    });

    const { ExpenseModelCtor } = mockSuccessfulCreate({
      fxRateToBoardCurrency: 999,
    });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ...baseProviders.slice(0, 1),
        { provide: getModelToken(Expense.name), useValue: ExpenseModelCtor },
        ...baseProviders.slice(2),
      ],
    }).compile();

    const expensesService = module.get(ExpensesService);
    await expensesService.create(
      {
        boardId: boardId.toString(),
        amount: 5,
        currency: 'USD',
        fxRateOverride: 999,
        description: 'Manual FX',
      },
      userId,
    );

    expect(expenseFxResolver.resolveSpotSnapshot).toHaveBeenCalledWith(
      'USD',
      'ARS',
      999,
    );
  });

  it('should reject cross-currency expense when FX cannot be resolved', async () => {
    boardsService.findByIdOrFail.mockResolvedValue({
      _id: boardId,
      type: BoardType.EVERYDAY,
      baseCurrency: 'ARS',
    });
    participantModel.findOne.mockResolvedValue({ _id: participantId });
    expenseFxResolver.buildFxOnCreate.mockReturnValue({
      fxPolicy: ExpenseFxPolicy.SPOT,
      fxPurpose: ExpenseFxPurpose.SETTLED,
    });
    expenseFxResolver.resolveSpotSnapshot.mockRejectedValue(
      new BadRequestException(
        'Tipo de cambio requerido: para USD/ARS se usa DolarApi automáticamente; para otras monedas enviá fxRateOverride o configurá FX_API_KEY.',
      ),
    );

    await expect(
      service.create(
        {
          boardId: boardId.toString(),
          amount: 10,
          currency: 'USD',
          description: 'Sin FX',
        },
        userId,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
