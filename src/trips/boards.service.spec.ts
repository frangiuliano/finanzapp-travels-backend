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

describe('BoardsService', () => {
  let service: BoardsService;

  const boardId = new Types.ObjectId();
  const userId = new Types.ObjectId().toString();

  const boardModel = {
    updateMany: jest.fn().mockResolvedValue({ modifiedCount: 0 }),
    create: jest.fn(),
    find: jest.fn(),
    findById: jest.fn(),
    findByIdAndDelete: jest.fn(),
  };

  const participantModel = {
    create: jest.fn(),
    find: jest.fn(),
    findOne: jest.fn(),
    deleteMany: jest.fn(),
  };

  const budgetModel = {
    deleteMany: jest.fn(),
  };

  const invitationModel = {
    deleteMany: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

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
      ],
    }).compile();

    service = module.get(BoardsService);
  });

  describe('onModuleInit', () => {
    it('should backfill missing type to travel', async () => {
      boardModel.updateMany.mockResolvedValue({ modifiedCount: 3 });
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
});
