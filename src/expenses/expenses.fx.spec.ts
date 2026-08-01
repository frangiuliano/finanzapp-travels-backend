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

    return { ExpenseModelCtor, saved, capturedAt };
  }

  it('should persist FX snapshot when expense currency differs from board', async () => {
    const capturedAt = new Date('2026-07-01T12:00:00.000Z');
    fxService.resolveSnapshot.mockResolvedValue({
      fxRateToBoardCurrency: 1200,
      fxCapturedAt: capturedAt,
    });

    const { ExpenseModelCtor } = mockSuccessfulCreate();

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

    expect(fxService.resolveSnapshot).toHaveBeenCalledWith(
      'USD',
      'ARS',
      undefined,
    );
    expect(ExpenseModelCtor).toHaveBeenCalledWith(
      expect.objectContaining({
        currency: 'USD',
        fxRateToBoardCurrency: 1200,
        fxCapturedAt: capturedAt,
      }),
    );
  });

  it('should pass fxRateOverride to FX service', async () => {
    fxService.resolveSnapshot.mockResolvedValue({
      fxRateToBoardCurrency: 999,
      fxCapturedAt: new Date(),
    });

    const { ExpenseModelCtor } = mockSuccessfulCreate({
      fxRateToBoardCurrency: 999,
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

    expect(fxService.resolveSnapshot).toHaveBeenCalledWith('USD', 'ARS', 999);
  });

  it('should reject cross-currency expense when FX cannot be resolved', async () => {
    boardsService.findByIdOrFail.mockResolvedValue({
      _id: boardId,
      type: BoardType.EVERYDAY,
      baseCurrency: 'ARS',
    });
    participantModel.findOne.mockResolvedValue({ _id: participantId });
    fxService.resolveSnapshot.mockRejectedValue(
      new BadRequestException(
        'Tipo de cambio requerido: configura FX_API_KEY o envía fxRateOverride al crear el gasto',
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
