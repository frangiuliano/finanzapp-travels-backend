import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import {
  ForbiddenException,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { Types } from 'mongoose';
import { CategoriesService } from './categories.service';
import { Category } from './category.schema';
import { ParticipantsService } from '../participants/participants.service';
import { DEFAULT_CATEGORIES } from './constants/default-categories';

describe('CategoriesService', () => {
  let service: CategoriesService;

  const boardId = new Types.ObjectId();
  const categoryId = new Types.ObjectId();
  const userId = new Types.ObjectId().toString();

  const categoryModel = {
    insertMany: jest.fn(),
    find: jest.fn(),
    findById: jest.fn(),
    findOne: jest.fn(),
    deleteMany: jest.fn(),
  };

  const participantsService = {
    ensureParticipantAccess: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CategoriesService,
        { provide: getModelToken(Category.name), useValue: categoryModel },
        { provide: ParticipantsService, useValue: participantsService },
      ],
    }).compile();

    service = module.get(CategoriesService);
  });

  describe('seedDefaults', () => {
    it('should insert default categories for a board', async () => {
      const seeded = DEFAULT_CATEGORIES.map((item) => ({
        _id: new Types.ObjectId(),
        tripId: boardId,
        ...item,
        isActive: true,
        isDefault: true,
      }));
      categoryModel.insertMany.mockResolvedValue(seeded);

      const result = await service.seedDefaults(boardId.toString());

      expect(categoryModel.insertMany).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            tripId: boardId,
            name: 'Comida',
            isDefault: true,
            isActive: true,
          }),
        ]),
      );
      expect(result).toHaveLength(DEFAULT_CATEGORIES.length);
    });
  });

  describe('findAllByBoard', () => {
    it('should require participant access', async () => {
      participantsService.ensureParticipantAccess.mockRejectedValue(
        new ForbiddenException('No tienes acceso a este viaje'),
      );

      await expect(
        service.findAllByBoard(boardId.toString(), userId),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('should return active categories sorted for members', async () => {
      participantsService.ensureParticipantAccess.mockResolvedValue(undefined);
      const chain = {
        sort: jest.fn().mockReturnThis(),
        lean: jest
          .fn()
          .mockResolvedValue([
            { _id: categoryId, name: 'Comida', isActive: true },
          ]),
      };
      categoryModel.find.mockReturnValue(chain);

      const result = await service.findAllByBoard(boardId.toString(), userId);

      expect(categoryModel.find).toHaveBeenCalledWith({
        tripId: boardId,
        isActive: true,
      });
      expect(result).toHaveLength(1);
    });
  });

  describe('create', () => {
    it('should reject duplicate active category names', async () => {
      participantsService.ensureParticipantAccess.mockResolvedValue(undefined);
      categoryModel.findOne.mockResolvedValue({
        _id: categoryId,
        name: 'Comida',
      });

      await expect(
        service.create({ boardId: boardId.toString(), name: 'comida' }, userId),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('archive', () => {
    it('should soft-delete by setting isActive false', async () => {
      const categoryDoc = {
        _id: categoryId,
        tripId: boardId,
        name: 'Comida',
        isActive: true,
        save: jest.fn().mockResolvedValue({
          _id: categoryId,
          name: 'Comida',
          isActive: false,
        }),
      };
      categoryModel.findById.mockResolvedValue(categoryDoc);
      participantsService.ensureParticipantAccess.mockResolvedValue(undefined);
      categoryModel.findOne.mockResolvedValue(null);

      const result = await service.archive(categoryId.toString(), userId);

      expect(categoryDoc.isActive).toBe(false);
      expect(categoryDoc.save).toHaveBeenCalled();
      expect(result.isActive).toBe(false);
    });
  });

  describe('update reactivation', () => {
    it('should reject reactivating when another active category has the same name', async () => {
      const archivedCategoryId = new Types.ObjectId();
      const categoryDoc = {
        _id: archivedCategoryId,
        tripId: boardId,
        name: 'Comida',
        isActive: false,
        save: jest.fn(),
      };
      categoryModel.findById.mockResolvedValue(categoryDoc);
      participantsService.ensureParticipantAccess.mockResolvedValue(undefined);
      categoryModel.findOne.mockResolvedValue({
        _id: categoryId,
        name: 'Comida',
        isActive: true,
      });

      await expect(
        service.update(
          archivedCategoryId.toString(),
          { isActive: true },
          userId,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);

      expect(categoryDoc.save).not.toHaveBeenCalled();
    });
  });

  describe('findOne', () => {
    it('should throw when category does not exist', async () => {
      categoryModel.findById.mockReturnValue({
        lean: jest.fn().mockResolvedValue(null),
      });

      await expect(
        service.findOne(categoryId.toString(), userId),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
