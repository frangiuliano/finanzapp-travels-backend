import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import {
  ForbiddenException,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { BoardsService } from './trips.service';
import { Board, BoardType } from './board.schema';
import {
  Participant,
  ParticipantRole,
} from '../participants/schemas/participant.schema';
import { Budget } from '../budgets/budget.schema';
import { Invitation } from '../participants/schemas/invitation.schema';
import { Types } from 'mongoose';
import { CategoriesService } from '../categories/categories.service';
import { PaymentMethodsService } from '../payment-methods/payment-methods.service';
import { Expense } from '../expenses/expense.schema';
import { Income } from '../incomes/income.schema';
import { RecurringIncome } from '../recurring-incomes/recurring-income.schema';
import { RecurringIncomeVersion } from '../recurring-incomes/recurring-income-version.schema';
import { RecurringExpense } from '../recurring-expenses/recurring-expense.schema';
import { RecurringExpenseVersion } from '../recurring-expenses/recurring-expense-version.schema';
import { InstallmentPlan } from '../installment-plans/installment-plan.schema';
import { BoardMonthBudget } from '../board-month-budgets/board-month-budget.schema';
import { Card } from '../cards/card.schema';
import { User } from '../users/user.schema';
import { BotUpdate } from '../bot/bot-update.schema';
import { PaymentMethod } from '../payment-methods/payment-method.schema';
import { BillingPeriod } from '../billing-periods/billing-period.schema';
import { InAppNotification } from '../in-app-notifications/in-app-notification.schema';

describe('BoardsService', () => {
  let service: BoardsService;

  const boardId = new Types.ObjectId();
  const userId = new Types.ObjectId().toString();

  const boardModel = {
    updateMany: jest.fn().mockResolvedValue({ modifiedCount: 0 }),
    create: jest.fn(),
    find: jest.fn(),
    findOne: jest.fn(),
    findById: jest.fn(),
    findByIdAndDelete: jest.fn(),
  };

  const participantModel = {
    create: jest.fn(),
    find: jest.fn(),
    findOne: jest.fn(),
    deleteMany: jest.fn(),
    updateMany: jest.fn(),
  };

  const budgetModel = {
    deleteMany: jest.fn(),
  };

  const invitationModel = {
    deleteMany: jest.fn(),
  };

  const cascadeModel = {
    deleteMany: jest.fn(),
    updateMany: jest.fn(),
  };

  const recurringModel = {
    ...cascadeModel,
    find: jest.fn().mockReturnValue({
      select: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue([]),
      }),
    }),
  };

  const cascadeProviders = [
    { provide: getModelToken(Expense.name), useValue: cascadeModel },
    { provide: getModelToken(Income.name), useValue: cascadeModel },
    { provide: getModelToken(RecurringIncome.name), useValue: recurringModel },
    {
      provide: getModelToken(RecurringIncomeVersion.name),
      useValue: cascadeModel,
    },
    { provide: getModelToken(RecurringExpense.name), useValue: recurringModel },
    {
      provide: getModelToken(RecurringExpenseVersion.name),
      useValue: cascadeModel,
    },
    { provide: getModelToken(InstallmentPlan.name), useValue: cascadeModel },
    { provide: getModelToken(BoardMonthBudget.name), useValue: cascadeModel },
    { provide: getModelToken(Card.name), useValue: recurringModel },
    { provide: getModelToken(User.name), useValue: cascadeModel },
    { provide: getModelToken(BotUpdate.name), useValue: cascadeModel },
    { provide: getModelToken(PaymentMethod.name), useValue: recurringModel },
    { provide: getModelToken(BillingPeriod.name), useValue: cascadeModel },
    { provide: getModelToken(InAppNotification.name), useValue: cascadeModel },
  ];

  const categoriesService = {
    seedDefaults: jest.fn().mockResolvedValue([]),
    deleteByBoard: jest.fn().mockResolvedValue(undefined),
  };

  const paymentMethodsService = {
    seedDefaults: jest.fn().mockResolvedValue([]),
    deleteByBoard: jest.fn().mockResolvedValue(undefined),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    boardModel.findOne.mockResolvedValue(null);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BoardsService,
        { provide: getModelToken(Board.name), useValue: boardModel },
        {
          provide: getModelToken(Participant.name),
          useValue: participantModel,
        },
        { provide: getModelToken(Budget.name), useValue: budgetModel },
        { provide: getModelToken(Invitation.name), useValue: invitationModel },
        ...cascadeProviders,
        { provide: CategoriesService, useValue: categoriesService },
        { provide: PaymentMethodsService, useValue: paymentMethodsService },
      ],
    }).compile();

    service = module.get(BoardsService);
  });

  describe('onModuleInit', () => {
    it('should backfill missing type to travel', async () => {
      boardModel.updateMany.mockResolvedValue({ modifiedCount: 3 });
      boardModel.find.mockReturnValue({
        select: jest.fn().mockReturnValue({
          lean: jest.fn().mockResolvedValue([]),
        }),
      });
      await service.onModuleInit();
      expect(boardModel.updateMany).toHaveBeenCalledWith(
        { type: { $exists: false } },
        { $set: { type: BoardType.TRAVEL } },
      );
    });
  });

  describe('create', () => {
    it('should default type to travel when omitted (legacy clients)', async () => {
      const saved = {
        _id: boardId,
        name: 'Europa',
        type: BoardType.TRAVEL,
        save: jest.fn(),
      };
      const boardInstance = {
        ...saved,
        save: jest.fn().mockResolvedValue(saved),
      };
      const BoardModelCtor = jest.fn().mockImplementation(() => boardInstance);
      Object.assign(BoardModelCtor, boardModel);

      const module: TestingModule = await Test.createTestingModule({
        providers: [
          BoardsService,
          { provide: getModelToken(Board.name), useValue: BoardModelCtor },
          {
            provide: getModelToken(Participant.name),
            useValue: participantModel,
          },
          { provide: getModelToken(Budget.name), useValue: budgetModel },
          {
            provide: getModelToken(Invitation.name),
            useValue: invitationModel,
          },
          ...cascadeProviders,
          { provide: CategoriesService, useValue: categoriesService },
          { provide: PaymentMethodsService, useValue: paymentMethodsService },
        ],
      }).compile();

      const boardsService = module.get(BoardsService);
      const result = await boardsService.create({ name: 'Europa' }, userId);

      expect(BoardModelCtor).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'Europa',
          type: BoardType.TRAVEL,
        }),
      );
      expect(participantModel.create).toHaveBeenCalledWith(
        expect.objectContaining({
          role: ParticipantRole.OWNER,
        }),
      );
      expect(categoriesService.seedDefaults).toHaveBeenCalledWith(
        boardId.toString(),
      );
      expect(paymentMethodsService.seedDefaults).toHaveBeenCalledWith(
        boardId.toString(),
      );
      expect(result).toEqual(saved);
    });

    it('should create an everyday board when type is everyday', async () => {
      const saved = {
        _id: boardId,
        name: 'Hogar',
        type: BoardType.EVERYDAY,
      };
      const boardInstance = {
        save: jest.fn().mockResolvedValue(saved),
      };
      const BoardModelCtor = jest.fn().mockImplementation(() => boardInstance);
      Object.assign(BoardModelCtor, boardModel);

      const module: TestingModule = await Test.createTestingModule({
        providers: [
          BoardsService,
          { provide: getModelToken(Board.name), useValue: BoardModelCtor },
          {
            provide: getModelToken(Participant.name),
            useValue: participantModel,
          },
          { provide: getModelToken(Budget.name), useValue: budgetModel },
          {
            provide: getModelToken(Invitation.name),
            useValue: invitationModel,
          },
          ...cascadeProviders,
          { provide: CategoriesService, useValue: categoriesService },
          { provide: PaymentMethodsService, useValue: paymentMethodsService },
        ],
      }).compile();

      const boardsService = module.get(BoardsService);
      await boardsService.create(
        { name: 'Hogar', type: BoardType.EVERYDAY },
        userId,
      );

      expect(BoardModelCtor).toHaveBeenCalledWith(
        expect.objectContaining({ type: BoardType.EVERYDAY }),
      );
    });
  });

  describe('findExpenseScope', () => {
    it('includes linked travel boards accessible to the user', async () => {
      const travelId = new Types.ObjectId();
      const parent = {
        _id: boardId,
        name: 'Casa',
        type: BoardType.EVERYDAY,
      };
      const travel = {
        _id: travelId,
        name: 'Salta',
        type: BoardType.TRAVEL,
        parentBoardId: boardId,
      };
      boardModel.findById.mockResolvedValue(parent);
      participantModel.findOne.mockResolvedValue({
        role: ParticipantRole.OWNER,
      });
      participantModel.find.mockResolvedValue([
        { _id: new Types.ObjectId(), tripId: travelId },
      ]);
      boardModel.find.mockResolvedValue([travel]);

      await expect(
        service.findExpenseScope(boardId.toString(), userId),
      ).resolves.toEqual([parent, travel]);
      expect(boardModel.find).toHaveBeenCalledWith({
        _id: { $in: [travelId] },
        type: BoardType.TRAVEL,
      });
    });
  });

  describe('assertTravelFeatures', () => {
    it('should allow travel boards', async () => {
      boardModel.findById.mockResolvedValue({
        _id: boardId,
        type: BoardType.TRAVEL,
      });
      await expect(
        service.assertTravelFeatures(boardId.toString()),
      ).resolves.toBeDefined();
    });

    it('should reject everyday boards', async () => {
      boardModel.findById.mockResolvedValue({
        _id: boardId,
        type: BoardType.EVERYDAY,
      });
      await expect(
        service.assertTravelFeatures(boardId.toString()),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('should throw when board is missing', async () => {
      boardModel.findById.mockResolvedValue(null);
      await expect(
        service.assertTravelFeatures(boardId.toString()),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('isTravelBoard', () => {
    it('should return true for travel boards', async () => {
      boardModel.findById.mockResolvedValue({
        _id: boardId,
        type: BoardType.TRAVEL,
      });
      await expect(service.isTravelBoard(boardId.toString())).resolves.toBe(
        true,
      );
    });

    it('should return false for everyday boards', async () => {
      boardModel.findById.mockResolvedValue({
        _id: boardId,
        type: BoardType.EVERYDAY,
      });
      await expect(service.isTravelBoard(boardId.toString())).resolves.toBe(
        false,
      );
    });
  });

  describe('assertEverydayFeatures', () => {
    it('should allow everyday boards', async () => {
      boardModel.findById.mockResolvedValue({
        _id: boardId,
        type: BoardType.EVERYDAY,
      });
      await expect(
        service.assertEverydayFeatures(boardId.toString()),
      ).resolves.toBeDefined();
    });

    it('should reject travel boards', async () => {
      boardModel.findById.mockResolvedValue({
        _id: boardId,
        type: BoardType.TRAVEL,
      });
      await expect(
        service.assertEverydayFeatures(boardId.toString()),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  describe('isEverydayBoard', () => {
    it('should return true for everyday boards', async () => {
      boardModel.findById.mockResolvedValue({
        _id: boardId,
        type: BoardType.EVERYDAY,
      });
      await expect(service.isEverydayBoard(boardId.toString())).resolves.toBe(
        true,
      );
    });

    it('should return false for travel boards', async () => {
      boardModel.findById.mockResolvedValue({
        _id: boardId,
        type: BoardType.TRAVEL,
      });
      await expect(service.isEverydayBoard(boardId.toString())).resolves.toBe(
        false,
      );
    });
  });

  describe('update type immutability', () => {
    it('should reject changing board type', async () => {
      participantModel.findOne.mockResolvedValue({
        role: ParticipantRole.OWNER,
      });
      boardModel.findById.mockResolvedValue({
        _id: boardId,
        type: BoardType.TRAVEL,
        name: 'Europa',
        save: jest.fn(),
      });

      await expect(
        service.update(
          boardId.toString(),
          { type: BoardType.EVERYDAY },
          userId,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('should allow updating name without changing type', async () => {
      const save = jest.fn().mockResolvedValue({
        populate: jest.fn().mockResolvedValue({
          _id: boardId,
          name: 'Nuevo',
          type: BoardType.TRAVEL,
        }),
      });
      participantModel.findOne.mockResolvedValue({
        role: ParticipantRole.OWNER,
      });
      boardModel.findById.mockResolvedValue({
        _id: boardId,
        type: BoardType.TRAVEL,
        name: 'Europa',
        save,
      });

      await service.update(boardId.toString(), { name: 'Nuevo' }, userId);
      expect(save).toHaveBeenCalled();
    });
  });

  describe('remove', () => {
    it('deletes owned data and detaches travel boards from an everyday board', async () => {
      participantModel.findOne.mockResolvedValue({
        role: ParticipantRole.OWNER,
      });
      boardModel.findById.mockResolvedValue({
        _id: boardId,
        type: BoardType.EVERYDAY,
      });

      await service.remove(boardId.toString(), userId);

      expect(boardModel.updateMany).toHaveBeenCalledWith(
        { parentBoardId: boardId },
        { $unset: { parentBoardId: 1 } },
      );
      expect(participantModel.updateMany).toHaveBeenCalledWith(
        { linkedEverydayBoardId: boardId },
        { $unset: { linkedEverydayBoardId: 1 } },
      );
      expect(cascadeModel.deleteMany).toHaveBeenCalledWith({
        tripId: boardId,
      });
      expect(categoriesService.deleteByBoard).toHaveBeenCalledWith(
        boardId.toString(),
      );
      expect(paymentMethodsService.deleteByBoard).toHaveBeenCalledWith(
        boardId.toString(),
      );
      expect(boardModel.findByIdAndDelete).toHaveBeenCalledWith(
        boardId.toString(),
      );
    });
  });
});
