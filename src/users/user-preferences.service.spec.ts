import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import { UserPreferencesService } from './user-preferences.service';
import { User } from './user.schema';
import { BoardsService } from '../trips/trips.service';
import { NotFoundException } from '@nestjs/common';

describe('UserPreferencesService', () => {
  let service: UserPreferencesService;

  const userId = new Types.ObjectId().toString();
  const boardId = new Types.ObjectId().toString();

  const userModel = {
    findById: jest.fn(),
    findByIdAndUpdate: jest.fn(),
  };

  const boardsService = {
    findOne: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UserPreferencesService,
        { provide: getModelToken(User.name), useValue: userModel },
        { provide: BoardsService, useValue: boardsService },
      ],
    }).compile();

    service = module.get(UserPreferencesService);
  });

  it('returns null when user has no active board', async () => {
    userModel.findById.mockReturnValue({
      select: jest.fn().mockResolvedValue({ activeBoardId: null }),
    });

    await expect(service.getActiveBoardId(userId)).resolves.toBeNull();
  });

  it('sets active board after validating access', async () => {
    boardsService.findOne.mockResolvedValue({ _id: boardId });
    userModel.findByIdAndUpdate.mockResolvedValue({});

    await expect(service.setActiveBoardId(userId, boardId)).resolves.toBe(
      boardId,
    );

    expect(boardsService.findOne).toHaveBeenCalledWith(boardId, userId);
    expect(userModel.findByIdAndUpdate).toHaveBeenCalled();
  });

  it('clears invalid active board on resolve', async () => {
    userModel.findById.mockReturnValue({
      select: jest
        .fn()
        .mockResolvedValue({ activeBoardId: new Types.ObjectId(boardId) }),
    });
    boardsService.findOne.mockRejectedValue(new NotFoundException());
    userModel.findByIdAndUpdate.mockResolvedValue({});

    await expect(service.resolveActiveBoard(userId)).resolves.toBeNull();
    expect(userModel.findByIdAndUpdate).toHaveBeenCalledWith(userId, {
      $set: { activeBoardId: null },
    });
  });
});
