import { AdaptiveExpenseParserService } from './adaptive-expense-parser.service';

describe('AdaptiveExpenseParserService', () => {
  const parser = new AdaptiveExpenseParserService();
  const context = {
    boardCurrency: 'ARS',
    categories: [
      { id: 'category-fuel', name: 'Nafta' },
      { id: 'category-food', name: 'Salidas' },
    ],
    paymentMethods: [
      {
        id: 'payment-visa',
        name: 'Visa Galicia',
        aliases: ['visa', 'galicia', 'credito'],
      },
      {
        id: 'payment-cash',
        name: 'Efectivo',
        aliases: ['efectivo'],
      },
    ],
  };

  it('resolves an Argentine thousands separator and matching options', () => {
    expect(parser.parse('Shell 35.000 pesos nafta con Visa', context)).toEqual({
      amount: 35000,
      currency: 'ARS',
      merchantName: 'Shell',
      description: 'Shell',
      categoryId: 'category-fuel',
      paymentMethodId: 'payment-visa',
      missingFields: [],
    });
  });

  it('resolves decimal amounts and an explicit foreign currency', () => {
    const result = parser.parse('Starbucks 12,50 USD salidas visa', context);
    expect(result.amount).toBe(12.5);
    expect(result.currency).toBe('USD');
    expect(result.merchantName).toBe('Starbucks');
  });

  it('reports only the fields that could not be inferred', () => {
    const result = parser.parse('15000', context);
    expect(result.amount).toBe(15000);
    expect(result.currency).toBe('ARS');
    expect(result.missingFields).toEqual([
      'merchantName',
      'categoryId',
      'paymentMethodId',
    ]);
  });

  it('does not guess when the same alias matches multiple options', () => {
    const result = parser.parse('Kiosco 8000 debito', {
      ...context,
      paymentMethods: [
        { id: 'debit-a', name: 'Débito A', aliases: ['debito'] },
        { id: 'debit-b', name: 'Débito B', aliases: ['debito'] },
      ],
    });
    expect(result.paymentMethodId).toBeUndefined();
    expect(result.missingFields).toContain('paymentMethodId');
  });
});
