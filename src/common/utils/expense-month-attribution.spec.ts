import { PaymentMethodKind } from '../../payment-methods/payment-method.schema';
import {
  expenseBelongsToYearMonth,
  getExpenseAttributionYearMonth,
} from './expense-month-attribution';

describe('expense-month-attribution', () => {
  const creditMethod = {
    kind: PaymentMethodKind.CREDIT,
    closingDay: 6,
  };

  it('uses calendar month in calendar mode', () => {
    expect(
      getExpenseAttributionYearMonth(
        { expenseDate: new Date('2026-07-27T12:00:00.000Z') },
        'calendar',
        creditMethod,
      ),
    ).toBe('2026-07');
  });

  it('uses billing cycle month for credit in cash_impact mode', () => {
    expect(
      getExpenseAttributionYearMonth(
        { expenseDate: new Date('2026-07-27T12:00:00.000Z') },
        'cash_impact',
        creditMethod,
      ),
    ).toBe('2026-08');
  });

  it('prefers stored billingCycleLabel in cash_impact mode', () => {
    expect(
      getExpenseAttributionYearMonth(
        {
          expenseDate: new Date('2026-07-27T12:00:00.000Z'),
          billingCycleLabel: '2026-08',
        },
        'cash_impact',
        creditMethod,
      ),
    ).toBe('2026-08');
  });

  it('keeps debit expenses on purchase month in cash_impact mode', () => {
    expect(
      getExpenseAttributionYearMonth(
        { expenseDate: new Date('2026-07-27T12:00:00.000Z') },
        'cash_impact',
        { kind: PaymentMethodKind.DEBIT },
      ),
    ).toBe('2026-07');
  });

  it('matches expenses to selected month with cash_impact attribution', () => {
    const paymentMethodMap = new Map([['card-1', creditMethod]]);

    expect(
      expenseBelongsToYearMonth(
        {
          expenseDate: new Date('2026-07-27T12:00:00.000Z'),
          paymentMethodId: 'card-1',
        },
        '2026-08',
        'cash_impact',
        paymentMethodMap,
      ),
    ).toBe(true);

    expect(
      expenseBelongsToYearMonth(
        {
          expenseDate: new Date('2026-07-27T12:00:00.000Z'),
          paymentMethodId: 'card-1',
        },
        '2026-07',
        'cash_impact',
        paymentMethodMap,
      ),
    ).toBe(false);
  });
});
