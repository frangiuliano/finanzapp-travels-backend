import { Injectable, Logger } from '@nestjs/common';
import { Card, CardType } from './card.schema';
import { CreateCardDto } from './dto/create-card.dto';
import { UpdateCardDto } from './dto/update-card.dto';
import { PaymentMethodsService } from '../payment-methods/payment-methods.service';
import {
  PaymentMethod,
  PaymentMethodKind,
  PaymentMethodOwnerType,
} from '../payment-methods/payment-method.schema';

@Injectable()
export class CardsService {
  private readonly logger = new Logger(CardsService.name);

  constructor(private paymentMethodsService: PaymentMethodsService) {}

  async create(createCardDto: CreateCardDto, userId: string): Promise<Card> {
    const paymentMethod = await this.paymentMethodsService.create(
      {
        ownerType: PaymentMethodOwnerType.USER,
        kind: PaymentMethodKind.CREDIT,
        tripId: createCardDto.tripId,
        name: createCardDto.name,
        lastFourDigits: createCardDto.lastFourDigits,
        brand: createCardDto.type ?? CardType.OTHER,
      },
      userId,
    );

    this.logger.log(
      `Tarjeta creada: ${paymentMethod.name} (****${paymentMethod.lastFourDigits})`,
    );

    return this.toLegacyCard(paymentMethod);
  }

  async findByUser(userId: string): Promise<Card[]> {
    const methods = await this.paymentMethodsService.findByUser(userId);
    return methods
      .filter(
        (m) =>
          m.kind === PaymentMethodKind.CREDIT ||
          m.kind === PaymentMethodKind.DEBIT,
      )
      .map((m) => this.toLegacyCard(m));
  }

  async findByTrip(tripId: string, userId: string): Promise<Card[]> {
    const methods = await this.paymentMethodsService.findAvailableForBoard(
      tripId,
      userId,
    );

    return methods
      .filter(
        (m) =>
          m.kind === PaymentMethodKind.CREDIT ||
          m.kind === PaymentMethodKind.DEBIT,
      )
      .map((m) => this.toLegacyCard(m));
  }

  async findOne(id: string, userId: string): Promise<Card> {
    const paymentMethod = await this.paymentMethodsService.findOne(id, userId);
    return this.toLegacyCard(paymentMethod);
  }

  async update(
    id: string,
    updateCardDto: UpdateCardDto,
    userId: string,
  ): Promise<Card> {
    const paymentMethod = await this.paymentMethodsService.update(
      id,
      {
        name: updateCardDto.name,
        lastFourDigits: updateCardDto.lastFourDigits,
        brand: updateCardDto.type,
        isActive: updateCardDto.isActive,
      },
      userId,
    );

    this.logger.log(
      `Tarjeta actualizada: ${paymentMethod.name} (****${paymentMethod.lastFourDigits})`,
    );

    return this.toLegacyCard(paymentMethod);
  }

  async remove(id: string, userId: string): Promise<void> {
    const paymentMethod = await this.paymentMethodsService.findOne(id, userId);
    await this.paymentMethodsService.archive(id, userId);
    this.logger.log(`Tarjeta eliminada: ${paymentMethod.name}`);
  }

  private toLegacyCard(paymentMethod: PaymentMethod): Card {
    const brand = paymentMethod.brand;
    const type =
      brand === CardType.VISA ||
      brand === CardType.MASTERCARD ||
      brand === CardType.AMEX ||
      brand === CardType.OTHER
        ? brand
        : CardType.OTHER;

    return {
      ...paymentMethod,
      userId: paymentMethod.userId!,
      tripId: paymentMethod.tripId,
      name: paymentMethod.name,
      lastFourDigits: paymentMethod.lastFourDigits ?? '0000',
      type,
      isActive: paymentMethod.isActive,
    } as Card;
  }
}
