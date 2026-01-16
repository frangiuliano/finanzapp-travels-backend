import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Card, CardDocument } from './card.schema';
import { CreateCardDto } from './dto/create-card.dto';
import { UpdateCardDto } from './dto/update-card.dto';
import { ParticipantsService } from '../participants/participants.service';
import { UserDocument } from '../users/user.schema';

@Injectable()
export class CardsService {
  private readonly logger = new Logger(CardsService.name);

  constructor(
    @InjectModel(Card.name) private cardModel: Model<CardDocument>,
    private participantsService: ParticipantsService,
  ) {}

  private extractUserId(
    cardUserId: Types.ObjectId | UserDocument | string,
  ): string {
    if (cardUserId instanceof Types.ObjectId) {
      return cardUserId.toString();
    }
    if (typeof cardUserId === 'object' && cardUserId !== null) {
      if ('_id' in cardUserId && cardUserId._id) {
        return cardUserId._id.toString();
      }
      throw new Error('Invalid userId format: object without _id');
    }
    if (typeof cardUserId === 'string') {
      return cardUserId;
    }
    throw new Error('Invalid userId format');
  }

  async create(createCardDto: CreateCardDto, userId: string): Promise<Card> {
    if (createCardDto.tripId) {
      await this.participantsService.ensureParticipantAccess(
        createCardDto.tripId,
        userId,
      );
    }

    const card = new this.cardModel({
      ...createCardDto,
      userId: new Types.ObjectId(userId),
      tripId: createCardDto.tripId
        ? new Types.ObjectId(createCardDto.tripId)
        : null,
    });

    const savedCard = await card.save();
    this.logger.log(
      `Tarjeta creada: ${savedCard.name} (****${savedCard.lastFourDigits})`,
    );

    return savedCard;
  }

  async findByUser(userId: string): Promise<Card[]> {
    return this.cardModel
      .find({
        userId: new Types.ObjectId(userId),
        isActive: true,
      })
      .populate('tripId', 'name')
      .sort({ createdAt: -1 })
      .lean();
  }

  async findByTrip(tripId: string, userId: string): Promise<Card[]> {
    await this.participantsService.ensureParticipantAccess(tripId, userId);

    const participants = await this.participantsService.findByTrip(
      tripId,
      userId,
    );

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
          const userIdStr = String(p.userId);
          participantUserIds.push(new Types.ObjectId(userIdStr));
        } catch {
          continue;
        }
      }
    }

    return this.cardModel
      .find({
        $or: [
          { tripId: new Types.ObjectId(tripId), isActive: true },
          {
            userId: { $in: participantUserIds },
            $or: [
              { tripId: { $exists: false } },
              { tripId: null },
              { tripId: new Types.ObjectId(tripId) },
            ],
            isActive: true,
          },
        ],
      })
      .populate('userId', 'firstName lastName')
      .populate('tripId', 'name')
      .sort({ createdAt: -1 })
      .lean();
  }

  async findOne(id: string, userId: string): Promise<Card> {
    const card = await this.cardModel.findById(id).lean();

    if (!card) {
      throw new NotFoundException('Tarjeta no encontrada');
    }

    const cardUserId = this.extractUserId(card.userId);

    if (cardUserId !== String(userId)) {
      throw new BadRequestException(
        'No tienes permiso para acceder a esta tarjeta',
      );
    }

    return card;
  }

  async update(
    id: string,
    updateCardDto: UpdateCardDto,
    userId: string,
  ): Promise<Card> {
    const card = await this.cardModel.findById(id);

    if (!card) {
      throw new NotFoundException('Tarjeta no encontrada');
    }

    const cardUserId = this.extractUserId(card.userId);

    if (cardUserId !== String(userId)) {
      throw new BadRequestException(
        'No tienes permiso para modificar esta tarjeta',
      );
    }

    if (updateCardDto.tripId) {
      await this.participantsService.ensureParticipantAccess(
        updateCardDto.tripId,
        userId,
      );
      card.tripId = new Types.ObjectId(updateCardDto.tripId);
    }

    if (updateCardDto.name !== undefined) {
      card.name = updateCardDto.name;
    }
    if (updateCardDto.lastFourDigits !== undefined) {
      card.lastFourDigits = updateCardDto.lastFourDigits;
    }
    if (updateCardDto.type !== undefined) {
      card.type = updateCardDto.type;
    }
    if (updateCardDto.isActive !== undefined) {
      card.isActive = updateCardDto.isActive;
    }

    const savedCard = await card.save();
    this.logger.log(
      `Tarjeta actualizada: ${savedCard.name} (****${savedCard.lastFourDigits})`,
    );

    return savedCard;
  }

  async remove(id: string, userId: string): Promise<void> {
    const card = await this.cardModel.findById(id);

    if (!card) {
      throw new NotFoundException('Tarjeta no encontrada');
    }

    const cardUserId = this.extractUserId(card.userId);

    if (cardUserId !== String(userId)) {
      throw new BadRequestException(
        'No tienes permiso para eliminar esta tarjeta',
      );
    }

    await this.cardModel.findByIdAndDelete(id);
    this.logger.log(`Tarjeta eliminada: ${card.name}`);
  }
}
