import { CardType } from '../../cards/card.schema';

/** Maps PaymentMethod.brand (or legacy type) to CardType for API responses. */
export function resolveCardTypeFromBrand(
  brand?: string,
  legacyType?: string,
): CardType {
  const candidate = legacyType ?? brand;
  if (
    candidate === CardType.VISA ||
    candidate === CardType.MASTERCARD ||
    candidate === CardType.AMEX ||
    candidate === CardType.OTHER
  ) {
    return candidate;
  }
  return CardType.OTHER;
}
