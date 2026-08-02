import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { Types } from 'mongoose';
import { PaymentMethodsService } from './payment-methods.service';
import {
  PaymentMethod,
  PaymentMethodKind,
  PaymentMethodOwnerType,
} from './payment-method.schema';
import { Card } from '../cards/card.schema';
import { ParticipantsService } from '../participants/participants.service';

describe('PaymentMethodsService', () => {
  let service: PaymentMethodsService;

  const boardId = new Types.ObjectId();
  const userId = new Types.ObjectId().toString();
  const otherUserId = new Types.ObjectId().toString();
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

  const participantsService = {
    ensureParticipantAccess: jest.fn(),
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
      expect(result).toHaveLength(1);
    });
  });
});
