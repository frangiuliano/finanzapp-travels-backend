import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
  OnModuleInit,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  PaymentMethod,
  PaymentMethodDocument,
  PaymentMethodKind,
  PaymentMethodOwnerType,
} from './payment-method.schema';
import { CreatePaymentMethodDto } from './dto/create-payment-method.dto';
import { UpdatePaymentMethodDto } from './dto/update-payment-method.dto';
import { ParticipantsService } from '../participants/participants.service';
import { resolveBoardId } from '../common/utils/resolve-board-id';
import { Card, CardDocument } from '../cards/card.schema';
import { UserDocument } from '../users/user.schema';

@Injectable()
export class PaymentMethodsService implements OnModuleInit {
  private readonly logger = new Logger(PaymentMethodsService.name);

  constructor(
    @InjectModel(PaymentMethod.name)
    private paymentMethodModel: Model<PaymentMethodDocument>,
    @InjectModel(Card.name)
    private cardModel: Model<CardDocument>,
    private participantsService: ParticipantsService,
  ) {}

  async onModuleInit(): Promise<void> {
    const cards = await this.cardModel.find().lean();
    let migrated = 0;

    for (const card of cards) {
      const existing = await this.paymentMethodModel.findOne({
        migratedFromCardId: card._id,
      });

      if (existing) {
        continue;
      }

      const byId = await this.paymentMethodModel.findById(card._id);
      if (byId) {
        continue;
      }

      await this.paymentMethodModel.create({
        _id: card._id,
        ownerType: PaymentMethodOwnerType.USER,
        kind: PaymentMethodKind.CREDIT,
        userId: card.userId,
        name: card.name,
        lastFourDigits: card.lastFourDigits,
        brand: card.type,
        isActive: card.isActive,
        migratedFromCardId: card._id,
      });
      migrated += 1;
    }

    if (migrated > 0) {
      this.logger.log(`Migrated ${migrated} legacy cards to payment methods`);
    }
  }

  async create(
    createDto: CreatePaymentMethodDto,
    userId: string,
  ): Promise<PaymentMethod> {
    this.assertKindAllowed(createDto.kind);

    if (createDto.ownerType === PaymentMethodOwnerType.USER) {
      const method = new this.paymentMethodModel({
        ownerType: PaymentMethodOwnerType.USER,
        kind: createDto.kind,
        userId: new Types.ObjectId(userId),
        name: createDto.name.trim(),
        lastFourDigits: createDto.lastFourDigits,
        brand: createDto.brand,
        closingDay: this.resolveClosingDay(
          createDto.kind,
          createDto.closingDay,
        ),
        dueDay: createDto.dueDay,
        isActive: true,
      });

      return method.save();
    }

    const boardId = resolveBoardId(createDto);
    if (!boardId) {
      throw new BadRequestException('boardId o tripId es requerido');
    }

    await this.participantsService.ensureParticipantAccess(boardId, userId);

    const method = new this.paymentMethodModel({
      ownerType: PaymentMethodOwnerType.BOARD,
      kind: createDto.kind,
      tripId: new Types.ObjectId(boardId),
      name: createDto.name.trim(),
      lastFourDigits: createDto.lastFourDigits,
      brand: createDto.brand,
      closingDay: this.resolveClosingDay(createDto.kind, createDto.closingDay),
      dueDay: createDto.dueDay,
      isActive: true,
    });

    return method.save();
  }

  async findByUser(
    userId: string,
    includeInactive = false,
  ): Promise<PaymentMethod[]> {
    const filter: Record<string, unknown> = {
      ownerType: PaymentMethodOwnerType.USER,
      userId: new Types.ObjectId(userId),
    };

    if (!includeInactive) {
      filter.isActive = true;
    }

    return this.paymentMethodModel
      .find(filter)
      .sort({ kind: 1, name: 1 })
      .lean();
  }

  async findBoardOwned(
    boardId: string,
    userId: string,
    includeInactive = false,
  ): Promise<PaymentMethod[]> {
    await this.participantsService.ensureParticipantAccess(boardId, userId);

    const filter: Record<string, unknown> = {
      ownerType: PaymentMethodOwnerType.BOARD,
      tripId: new Types.ObjectId(boardId),
    };

    if (!includeInactive) {
      filter.isActive = true;
    }

    return this.paymentMethodModel
      .find(filter)
      .sort({ kind: 1, name: 1 })
      .lean();
  }

  async findAvailableForBoard(
    boardId: string,
    userId: string,
    includeInactive = false,
  ): Promise<PaymentMethod[]> {
    await this.participantsService.ensureParticipantAccess(boardId, userId);

    const participants = await this.participantsService.findByTrip(
      boardId,
      userId,
    );
    const participantUserIds = this.extractParticipantUserIds(participants);

    const activeFilter = includeInactive ? {} : { isActive: true };

    return this.paymentMethodModel
      .find({
        $or: [
          {
            ownerType: PaymentMethodOwnerType.BOARD,
            tripId: new Types.ObjectId(boardId),
            ...activeFilter,
          },
          {
            ownerType: PaymentMethodOwnerType.USER,
            userId: { $in: participantUserIds },
            ...activeFilter,
          },
        ],
      })
      .populate('userId', 'firstName lastName')
      .populate('tripId', 'name')
      .sort({ ownerType: 1, kind: 1, name: 1 })
      .lean();
  }

  async findOne(id: string, userId: string): Promise<PaymentMethod> {
    const method = await this.paymentMethodModel.findById(id).lean();

    if (!method) {
      throw new NotFoundException('Medio de pago no encontrado');
    }

    await this.ensureCanAccess(method, userId);

    return method;
  }

  async update(
    id: string,
    updateDto: UpdatePaymentMethodDto,
    userId: string,
  ): Promise<PaymentMethod> {
    const method = await this.paymentMethodModel.findById(id);

    if (!method) {
      throw new NotFoundException('Medio de pago no encontrado');
    }

    await this.ensureCanModify(method, userId);

    if (updateDto.name !== undefined) {
      method.name = updateDto.name.trim();
    }
    if (updateDto.lastFourDigits !== undefined) {
      method.lastFourDigits = updateDto.lastFourDigits;
    }
    if (updateDto.brand !== undefined) {
      method.brand = updateDto.brand;
    }
    if (updateDto.closingDay !== undefined) {
      method.closingDay = this.resolveClosingDay(
        method.kind,
        updateDto.closingDay,
      );
    }
    if (updateDto.dueDay !== undefined) {
      method.dueDay = updateDto.dueDay;
    }
    if (updateDto.isActive !== undefined) {
      method.isActive = updateDto.isActive;
    }

    return method.save();
  }

  async archive(id: string, userId: string): Promise<PaymentMethod> {
    return this.update(id, { isActive: false }, userId);
  }

  async deleteByBoard(boardId: string): Promise<void> {
    await this.paymentMethodModel.deleteMany({
      ownerType: PaymentMethodOwnerType.BOARD,
      tripId: new Types.ObjectId(boardId),
    });
  }

  private async ensureCanAccess(
    method: PaymentMethod,
    userId: string,
  ): Promise<void> {
    if (method.ownerType === PaymentMethodOwnerType.USER) {
      if (method.userId?.toString() !== userId) {
        throw new BadRequestException(
          'No tienes permiso para acceder a este medio de pago',
        );
      }
      return;
    }

    if (!method.tripId) {
      throw new BadRequestException('Medio de pago del tablero inválido');
    }

    await this.participantsService.ensureParticipantAccess(
      method.tripId.toString(),
      userId,
    );
  }

  private async ensureCanModify(
    method: PaymentMethodDocument,
    userId: string,
  ): Promise<void> {
    if (method.ownerType === PaymentMethodOwnerType.USER) {
      if (method.userId?.toString() !== userId) {
        throw new BadRequestException(
          'No tienes permiso para modificar este medio de pago',
        );
      }
      return;
    }

    if (!method.tripId) {
      throw new BadRequestException('Medio de pago del tablero inválido');
    }

    await this.participantsService.ensureParticipantAccess(
      method.tripId.toString(),
      userId,
    );
  }

  private assertKindAllowed(kind: PaymentMethodKind): void {
    const allowed = [
      PaymentMethodKind.CASH,
      PaymentMethodKind.DEBIT,
      PaymentMethodKind.CREDIT,
    ];
    if (!allowed.includes(kind)) {
      throw new BadRequestException('kind debe ser cash, debit o credit');
    }
  }

  private resolveClosingDay(
    kind: PaymentMethodKind,
    closingDay?: number,
  ): number | undefined {
    if (closingDay === undefined) {
      return undefined;
    }

    if (kind !== PaymentMethodKind.CREDIT) {
      throw new BadRequestException(
        'closingDay solo aplica a medios de pago de crédito',
      );
    }

    if (closingDay < 1 || closingDay > 28) {
      throw new BadRequestException('closingDay debe estar entre 1 y 28');
    }

    return closingDay;
  }

  private extractParticipantUserIds(
    participants: Awaited<ReturnType<ParticipantsService['findByTrip']>>,
  ): Types.ObjectId[] {
    const participantUserIds: Types.ObjectId[] = [];

    for (const p of participants) {
      if (!p.userId) {
        continue;
      }

      if (p.userId instanceof Types.ObjectId) {
        participantUserIds.push(p.userId);
      } else if (typeof p.userId === 'object' && p.userId !== null) {
        const userDoc = p.userId as UserDocument;
        if ('_id' in userDoc && userDoc._id) {
          participantUserIds.push(new Types.ObjectId(userDoc._id.toString()));
        } else if ('id' in userDoc && userDoc.id) {
          const idValue = userDoc.id;
          if (idValue instanceof Types.ObjectId) {
            participantUserIds.push(idValue);
          } else if (
            typeof idValue === 'string' ||
            typeof idValue === 'number'
          ) {
            participantUserIds.push(new Types.ObjectId(String(idValue)));
          }
        }
      } else {
        try {
          participantUserIds.push(new Types.ObjectId(String(p.userId)));
        } catch {
          continue;
        }
      }
    }

    return participantUserIds;
  }
}
