import { getExpenseAmountInBoardCurrency } from './expense-board-currency';

describe('getExpenseAmountInBoardCurrency', () => {
  it('returns amount when currencies match', () => {
    expect(
      getExpenseAmountInBoardCurrency({ amount: 100, currency: 'ARS' }, 'ARS'),
    ).toBe(100);
  });

  it('converts using FX snapshot when currencies differ', () => {
    expect(
      getExpenseAmountInBoardCurrency(
        {
          amount: 10,
          currency: 'USD',
          fxRateToBoardCurrency: 1200,
        },
        'ARS',
      ),
    ).toBe(12000);
  });

  it('returns null for legacy expenses without FX snapshot', () => {
    expect(
      getExpenseAmountInBoardCurrency({ amount: 10, currency: 'USD' }, 'ARS'),
    ).toBeNull();
  });
});
