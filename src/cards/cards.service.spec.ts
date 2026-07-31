import { Types } from 'mongoose';
import { CardType } from './card.schema';
import {
  PaymentMethod,
  PaymentMethodKind,
  PaymentMethodOwnerType,
} from '../payment-methods/payment-method.schema';
import { CardsService } from './cards.service';
import { PaymentMethodsService } from '../payment-methods/payment-methods.service';

describe('CardsService', () => {
  const paymentMethodsService = {
    findAvailableForBoard: jest.fn(),
  };

  let service: CardsService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new CardsService(
      paymentMethodsService as unknown as PaymentMethodsService,
    );
  });

  it('should map board-owned payment methods without userId', async () => {
    const boardId = new Types.ObjectId();
    const methodId = new Types.ObjectId();

    paymentMethodsService.findAvailableForBoard.mockResolvedValue([
      {
        _id: methodId,
        ownerType: PaymentMethodOwnerType.BOARD,
        kind: PaymentMethodKind.CREDIT,
        tripId: boardId,
        name: 'Visa compartida',
        lastFourDigits: '4242',
        brand: CardType.VISA,
        isActive: true,
      } as PaymentMethod,
    ]);

    const cards = await service.findByTrip(boardId.toString(), 'user-1');

    expect(cards).toHaveLength(1);
    expect(cards[0].type).toBe(CardType.VISA);
    expect(cards[0].userId).toBeUndefined();
    expect(cards[0].tripId?.toString()).toBe(boardId.toString());
  });
});
