import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import { ExpensesService } from './expenses.service';
import { Expense } from './expense.schema';
import { Budget } from '../budgets/budget.schema';
import { Participant } from '../participants/schemas/participant.schema';
import { BoardsService } from '../trips/trips.service';
import { CategoriesService } from '../categories/categories.service';
import { PaymentMethodsService } from '../payment-methods/payment-methods.service';
import { FxService } from '../fx/fx.service';
import { ExpenseFxResolver } from '../fx/expense-fx.resolver';
import { RecurringMaterializationService } from '../recurring-materialization/recurring-materialization.service';

describe('ExpensesService idempotency', () => {
  let service: ExpensesService;

  const boardId = new Types.ObjectId();
  const participantId = new Types.ObjectId();
  const userId = new Types.ObjectId().toString();
  const clientRequestId = '550e8400-e29b-41d4-a716-446655440000';
  const existingExpenseId = new Types.ObjectId();

  const existingLean = {
    _id: existingExpenseId,
    tripId: boardId,
    amount: 42,
    currency: 'USD',
    description: 'Offline cafe',
    clientRequestId,
    paidByParticipantId: participantId,
    createdBy: new Types.ObjectId(userId),
    status: 'paid',
    paymentMethod: 'cash',
    isDivisible: false,
    expenseDate: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const expenseModel = {
    findOne: jest.fn(),
    findById: jest.fn(),
    prototype: { save: jest.fn() },
  };

  const budgetModel = { findById: jest.fn(), findByIdAndUpdate: jest.fn() };
  const participantModel = { findOne: jest.fn(), find: jest.fn() };

  const boardsService = {
    findByIdOrFail: jest.fn(),
    assertTravelFeatures: jest.fn(),
    isTravelBoard: jest.fn(),
  };

  const categoriesService = { findOne: jest.fn() };
  const paymentMethodsService = { findAvailableForBoard: jest.fn() };
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

  it('returns existing expense when clientRequestId already exists', async () => {
    const chain = {
      populate: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue(existingLean),
    };
    expenseModel.findOne.mockReturnValue(chain);
    participantModel.findOne.mockResolvedValue({ _id: participantId });

    const result = await service.create(
      {
        boardId: boardId.toString(),
        amount: 99,
        description: 'Different amount',
        clientRequestId,
      },
      userId,
    );

    expect(expenseModel.findOne).toHaveBeenCalledWith({
      clientRequestId,
      createdBy: new Types.ObjectId(userId),
    });
    expect(boardsService.findByIdOrFail).not.toHaveBeenCalled();
    expect(result.amount).toBe(42);
    expect((result as { clientRequestId?: string }).clientRequestId).toBe(
      clientRequestId,
    );
  });
});
