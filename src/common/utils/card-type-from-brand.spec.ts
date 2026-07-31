import { CardType } from '../../cards/card.schema';
import { resolveCardTypeFromBrand } from './card-type-from-brand';

describe('resolveCardTypeFromBrand', () => {
  it('should prefer legacy type when present', () => {
    expect(resolveCardTypeFromBrand('visa', CardType.MASTERCARD)).toBe(
      CardType.MASTERCARD,
    );
  });

  it('should map brand to card type', () => {
    expect(resolveCardTypeFromBrand(CardType.VISA)).toBe(CardType.VISA);
  });

  it('should default unknown brands to other', () => {
    expect(resolveCardTypeFromBrand('unknown-network')).toBe(CardType.OTHER);
  });
});
