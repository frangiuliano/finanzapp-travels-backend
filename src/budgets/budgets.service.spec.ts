import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { ForbiddenException } from '@nestjs/common';
import { Types } from 'mongoose';
import { BudgetsService } from './budgets.service';
import { Budget } from './budget.schema';
import { Participant } from '../participants/schemas/participant.schema';
import { BoardsService } from '../trips/trips.service';

describe('BudgetsService board gates', () => {
  let service: BudgetsService;

  const boardId = new Types.ObjectId();
  const budgetId = new Types.ObjectId();
  const userId = new Types.ObjectId().toString();

  const budgetModel = {
    find: jest.fn(),
    findById: jest.fn(),
    findByIdAndDelete: jest.fn(),
  };

  const participantModel = {
    findOne: jest.fn(),
  };

  const boardsService = {
    assertTravelFeatures: jest.fn(),
    isTravelBoard: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BudgetsService,
        { provide: getModelToken(Budget.name), useValue: budgetModel },
        {
          provide: getModelToken(Participant.name),
          useValue: participantModel,
        },
        { provide: BoardsService, useValue: boardsService },
      ],
    }).compile();

    service = module.get(BudgetsService);
  });

  describe('findAllByTrip', () => {
    it('should return empty list for everyday boards without throwing', async () => {
      participantModel.findOne.mockResolvedValue({ _id: new Types.ObjectId() });
      boardsService.isTravelBoard.mockResolvedValue(false);

      await expect(
        service.findAllByTrip(boardId.toString(), userId),
      ).resolves.toEqual([]);
      expect(budgetModel.find).not.toHaveBeenCalled();
    });

    it('should list budgets for travel boards', async () => {
      participantModel.findOne.mockResolvedValue({ _id: new Types.ObjectId() });
      boardsService.isTravelBoard.mockResolvedValue(true);
      const chain = {
        populate: jest.fn().mockReturnThis(),
        sort: jest.fn().mockReturnThis(),
        lean: jest.fn().mockResolvedValue([{ _id: budgetId, name: 'Comida' }]),
      };
      budgetModel.find.mockReturnValue(chain);

      const result = await service.findAllByTrip(boardId.toString(), userId);
      expect(result).toHaveLength(1);
    });
  });

  describe('create', () => {
    it('should reject create on everyday boards', async () => {
      boardsService.assertTravelFeatures.mockRejectedValue(
        new ForbiddenException(
          'Esta operación solo está disponible en tableros de tipo travel',
        ),
      );

      await expect(
        service.create(
          { boardId: boardId.toString(), name: 'Comida', amount: 100 },
          userId,
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  describe('findOne / update / remove', () => {
    it('should assert travel features on findOne', async () => {
      budgetModel.findById.mockResolvedValue({
        _id: budgetId,
        tripId: boardId,
        lean: undefined,
      });
      budgetModel.findById.mockReturnValue({
        lean: jest.fn().mockResolvedValue({
          _id: budgetId,
          tripId: boardId,
        }),
      });
      boardsService.assertTravelFeatures.mockRejectedValue(
        new ForbiddenException('travel only'),
      );

      await expect(
        service.findOne(budgetId.toString(), userId),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('should assert travel features on update', async () => {
      budgetModel.findById.mockResolvedValue({
        _id: budgetId,
        tripId: boardId,
      });
      boardsService.assertTravelFeatures.mockRejectedValue(
        new ForbiddenException('travel only'),
      );

      await expect(
        service.update(budgetId.toString(), { name: 'X' }, userId),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('should assert travel features on remove', async () => {
      budgetModel.findById.mockResolvedValue({
        _id: budgetId,
        tripId: boardId,
      });
      boardsService.assertTravelFeatures.mockRejectedValue(
        new ForbiddenException('travel only'),
      );

      await expect(
        service.remove(budgetId.toString(), userId),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });
});
