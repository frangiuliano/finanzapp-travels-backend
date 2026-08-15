import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Types } from 'mongoose';
import { PaymentMethodsService } from './payment-methods.service';
import {
  PaymentMethod,
  PaymentMethodKind,
  PaymentMethodOwnerType,
} from './payment-method.schema';
import { Card } from '../cards/card.schema';
import { ParticipantsService } from '../participants/participants.service';
import { PaymentMethodBoardExclusion } from './payment-method-board-exclusion.schema';

describe('PaymentMethodsService', () => {
  let service: PaymentMethodsService;

  const boardId = new Types.ObjectId();
  const userId = new Types.ObjectId().toString();
  const otherUserId = new Types.ObjectId().toString();
  const otherBoardId = new Types.ObjectId();
  const methodId = new Types.ObjectId();

  const modelMethods = {
    find: jest.fn(),
    findById: jest.fn(),
    findOne: jest.fn(),
    deleteMany: jest.fn(),
    insertMany: jest.fn(),
    countDocuments: jest.fn(),
  };

  const paymentMethodModel = jest
    .fn()
    .mockImplementation((data: Record<string, unknown>) => ({
      ...data,
      save: jest.fn().mockResolvedValue({ ...data, _id: methodId }),
    }));
  Object.assign(paymentMethodModel, modelMethods);

  const cardModel = {
    find: jest.fn().mockResolvedValue([]),
  };

  const visibilityModel = {
    find: jest.fn(),
    updateOne: jest.fn(),
    deleteOne: jest.fn(),
  };

  const participantsService = {
    ensureParticipantAccess: jest.fn(),
    ensureBoardParticipantAccess: jest.fn(),
    findByTrip: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    cardModel.find.mockResolvedValue([]);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PaymentMethodsService,
        {
          provide: getModelToken(PaymentMethod.name),
          useValue: paymentMethodModel,
        },
        { provide: getModelToken(Card.name), useValue: cardModel },
        {
          provide: getModelToken(PaymentMethodBoardExclusion.name),
          useValue: visibilityModel,
        },
        { provide: ParticipantsService, useValue: participantsService },
      ],
    }).compile();

    service = module.get(PaymentMethodsService);
  });

  describe('create', () => {
    it('should create user-owned credit with closingDay', async () => {
      const result = await service.create(
        {
          ownerType: PaymentMethodOwnerType.USER,
          kind: PaymentMethodKind.CREDIT,
          name: 'Visa',
          lastFourDigits: '4242',
          closingDay: 14,
        },
        userId,
      );

      expect(result.closingDay).toBe(14);
      expect(result.kind).toBe(PaymentMethodKind.CREDIT);
    });

    it('should reject closingDay above 28', async () => {
      await expect(
        service.create(
          {
            ownerType: PaymentMethodOwnerType.USER,
            kind: PaymentMethodKind.CREDIT,
            name: 'Visa',
            lastFourDigits: '4242',
            closingDay: 31,
          },
          userId,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('should reject manual cash creation', async () => {
      await expect(
        service.create(
          {
            ownerType: PaymentMethodOwnerType.BOARD,
            boardId: boardId.toString(),
            kind: PaymentMethodKind.CASH,
            name: 'Efectivo hogar',
          },
          userId,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('should seed default cash for a board', async () => {
      modelMethods.insertMany.mockResolvedValue([
        {
          _id: methodId,
          ownerType: PaymentMethodOwnerType.BOARD,
          kind: PaymentMethodKind.CASH,
          name: 'Efectivo / Transferencia',
          isDefault: true,
        },
      ]);

      const result = await service.seedDefaults(boardId.toString());

      expect(modelMethods.insertMany).toHaveBeenCalled();
      expect(result).toHaveLength(1);
      expect(result[0].kind).toBe(PaymentMethodKind.CASH);
    });
  });

  describe('findAvailableForBoard', () => {
    it('should require participant access', async () => {
      participantsService.ensureParticipantAccess.mockRejectedValue(
        new ForbiddenException('No tienes acceso'),
      );

      await expect(
        service.findAvailableForBoard(boardId.toString(), otherUserId),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('should return board-owned and participant user-owned methods', async () => {
      participantsService.ensureParticipantAccess.mockResolvedValue(undefined);
      participantsService.findByTrip.mockResolvedValue([
        { userId: new Types.ObjectId(userId) },
      ]);
      modelMethods.countDocuments.mockResolvedValue(1);
      visibilityModel.find.mockReturnValue({
        distinct: jest.fn().mockResolvedValue([]),
      });

      const chain = {
        populate: jest.fn().mockReturnThis(),
        sort: jest.fn().mockReturnThis(),
        lean: jest.fn().mockResolvedValue([
          {
            _id: methodId,
            ownerType: PaymentMethodOwnerType.BOARD,
            kind: PaymentMethodKind.CASH,
            name: 'Efectivo',
          },
        ]),
      };
      modelMethods.find.mockReturnValue(chain);

      const result = await service.findAvailableForBoard(
        boardId.toString(),
        userId,
      );

      expect(modelMethods.find).toHaveBeenCalled();
      expect(modelMethods.find).toHaveBeenCalledWith(
        expect.objectContaining({
          $or: expect.arrayContaining([
            expect.objectContaining({
              ownerType: PaymentMethodOwnerType.USER,
              _id: { $nin: [] },
            }),
          ]),
        }),
      );
      expect(result).toHaveLength(1);
    });

    it('excludes only personal methods disabled for the requested board', async () => {
      const disabledMethodId = new Types.ObjectId();
      participantsService.ensureParticipantAccess.mockResolvedValue(undefined);
      participantsService.findByTrip.mockResolvedValue([
        { userId: new Types.ObjectId(userId) },
      ]);
      modelMethods.countDocuments.mockResolvedValue(1);
      visibilityModel.find.mockImplementation(
        (filter: { tripId: Types.ObjectId }) => ({
          distinct: jest
            .fn()
            .mockResolvedValue(
              filter.tripId.toString() === boardId.toString()
                ? [disabledMethodId]
                : [],
            ),
        }),
      );
      modelMethods.find.mockReturnValue({
        populate: jest.fn().mockReturnThis(),
        sort: jest.fn().mockReturnThis(),
        lean: jest.fn().mockResolvedValue([]),
      });

      await service.findAvailableForBoard(boardId.toString(), userId);
      expect(modelMethods.find).toHaveBeenLastCalledWith(
        expect.objectContaining({
          $or: expect.arrayContaining([
            expect.objectContaining({ _id: { $nin: [disabledMethodId] } }),
          ]),
        }),
      );

      await service.findAvailableForBoard(otherBoardId.toString(), userId);
      expect(modelMethods.find).toHaveBeenLastCalledWith(
        expect.objectContaining({
          $or: expect.arrayContaining([
            expect.objectContaining({ _id: { $nin: [] } }),
          ]),
        }),
      );
    });

    it('keeps board-owned methods and filters inactive methods as before', async () => {
      participantsService.ensureParticipantAccess.mockResolvedValue(undefined);
      participantsService.findByTrip.mockResolvedValue([]);
      modelMethods.countDocuments.mockResolvedValue(1);
      visibilityModel.find.mockReturnValue({
        distinct: jest.fn().mockResolvedValue([]),
      });
      modelMethods.find.mockReturnValue({
        populate: jest.fn().mockReturnThis(),
        sort: jest.fn().mockReturnThis(),
        lean: jest.fn().mockResolvedValue([]),
      });

      await service.findAvailableForBoard(boardId.toString(), userId);

      expect(modelMethods.find).toHaveBeenLastCalledWith(
        expect.objectContaining({
          $or: expect.arrayContaining([
            expect.objectContaining({
              ownerType: PaymentMethodOwnerType.BOARD,
              isActive: true,
            }),
            expect.objectContaining({
              ownerType: PaymentMethodOwnerType.USER,
              isActive: true,
            }),
          ]),
        }),
      );
    });
  });

  describe('board visibility', () => {
    const personalMethod = {
      _id: methodId,
      ownerType: PaymentMethodOwnerType.USER,
      userId: new Types.ObjectId(userId),
    };

    describe('participant configuration query', () => {
      const secondMethodId = new Types.ObjectId();
      const participantMethods = [
        {
          ...personalMethod,
          kind: PaymentMethodKind.CREDIT,
          name: 'Personal Visa',
          isActive: true,
        },
        {
          _id: secondMethodId,
          ownerType: PaymentMethodOwnerType.USER,
          userId: new Types.ObjectId(otherUserId),
          kind: PaymentMethodKind.DEBIT,
          name: 'Other debit',
          isActive: true,
        },
      ];

      beforeEach(() => {
        participantsService.ensureBoardParticipantAccess.mockResolvedValue(
          undefined,
        );
        participantsService.findByTrip.mockResolvedValue([
          { userId: new Types.ObjectId(userId) },
          { userId: new Types.ObjectId(otherUserId) },
        ]);
        modelMethods.find.mockReturnValue({
          select: jest.fn().mockReturnThis(),
          populate: jest.fn().mockReturnThis(),
          sort: jest.fn().mockReturnThis(),
          lean: jest.fn().mockResolvedValue(participantMethods),
        });
      });

      it('allows a participant and returns active personal methods for every participant', async () => {
        visibilityModel.find.mockReturnValue({
          distinct: jest.fn().mockResolvedValue([]),
        });

        const methods = await service.findParticipantMethodsForBoard(
          boardId.toString(),
          userId,
        );

        expect(
          participantsService.ensureBoardParticipantAccess,
        ).toHaveBeenCalledWith(boardId.toString(), userId);
        expect(modelMethods.find).toHaveBeenCalledWith({
          ownerType: PaymentMethodOwnerType.USER,
          userId: {
            $in: [new Types.ObjectId(userId), new Types.ObjectId(otherUserId)],
          },
          isActive: true,
        });
        expect(methods).toHaveLength(2);
      });

      it('returns enabled and disabled methods according to this board exclusions', async () => {
        visibilityModel.find.mockReturnValue({
          distinct: jest.fn().mockResolvedValue([secondMethodId]),
        });

        const methods = await service.findParticipantMethodsForBoard(
          boardId.toString(),
          userId,
        );

        expect(methods).toEqual([
          expect.objectContaining({ _id: methodId, enabled: true }),
          expect.objectContaining({ _id: secondMethodId, enabled: false }),
        ]);
      });

      it('rejects users outside the board before reading payment methods', async () => {
        participantsService.ensureBoardParticipantAccess.mockRejectedValue(
          new ForbiddenException('No tienes acceso'),
        );

        await expect(
          service.findParticipantMethodsForBoard(
            boardId.toString(),
            otherUserId,
          ),
        ).rejects.toBeInstanceOf(ForbiddenException);
        expect(modelMethods.find).not.toHaveBeenCalled();
      });
    });

    it('reports personal methods as enabled by default and includes the owner', async () => {
      participantsService.ensureBoardParticipantAccess.mockResolvedValue(
        undefined,
      );
      modelMethods.find.mockReturnValue({
        populate: jest.fn().mockReturnThis(),
        sort: jest.fn().mockReturnThis(),
        lean: jest.fn().mockResolvedValue([personalMethod]),
      });
      visibilityModel.find.mockReturnValue({
        distinct: jest.fn().mockResolvedValue([]),
      });

      const methods = await service.findUserMethodsForBoard(
        boardId.toString(),
        userId,
      );

      expect(methods[0]).toEqual(expect.objectContaining({ enabled: true }));
    });

    it('hides by upserting an exclusion without modifying the payment method', async () => {
      modelMethods.findById.mockResolvedValue(personalMethod);
      visibilityModel.updateOne.mockResolvedValue({ upsertedCount: 1 });

      const result = await service.updateBoardVisibility(
        methodId.toString(),
        boardId.toString(),
        false,
        userId,
      );

      expect(visibilityModel.updateOne).toHaveBeenCalledWith(
        expect.objectContaining({ paymentMethodId: methodId }),
        expect.any(Object),
        { upsert: true },
      );
      expect(result.enabled).toBe(false);
      expect(personalMethod).not.toHaveProperty('isActive');
    });

    it('re-enables by deleting the exclusion', async () => {
      modelMethods.findById.mockResolvedValue(personalMethod);
      visibilityModel.deleteOne.mockResolvedValue({ deletedCount: 1 });

      const result = await service.updateBoardVisibility(
        methodId.toString(),
        boardId.toString(),
        true,
        userId,
      );

      expect(visibilityModel.deleteOne).toHaveBeenCalled();
      expect(result.enabled).toBe(true);
    });

    it('rejects a participant who does not own the personal method', async () => {
      modelMethods.findById.mockResolvedValue(personalMethod);

      await expect(
        service.updateBoardVisibility(
          methodId.toString(),
          boardId.toString(),
          false,
          otherUserId,
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(visibilityModel.updateOne).not.toHaveBeenCalled();
    });

    it('rejects board-owned methods', async () => {
      modelMethods.findById.mockResolvedValue({
        _id: methodId,
        ownerType: PaymentMethodOwnerType.BOARD,
        tripId: boardId,
      });

      await expect(
        service.updateBoardVisibility(
          methodId.toString(),
          boardId.toString(),
          false,
          userId,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects missing methods', async () => {
      modelMethods.findById.mockResolvedValue(null);

      await expect(
        service.updateBoardVisibility(
          methodId.toString(),
          boardId.toString(),
          false,
          userId,
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('requires an existing board and owner participation', async () => {
      modelMethods.findById.mockResolvedValue(personalMethod);
      participantsService.ensureBoardParticipantAccess.mockRejectedValue(
        new ForbiddenException('No tienes acceso'),
      );

      await expect(
        service.updateBoardVisibility(
          methodId.toString(),
          boardId.toString(),
          false,
          userId,
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(visibilityModel.updateOne).not.toHaveBeenCalled();
    });
  });
});
