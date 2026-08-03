import { resolveCycleClosingMonth } from './credit-cycle';
import { getYearMonthFromDate } from './iterate-year-months';
import { PaymentMethodKind } from '../../payment-methods/payment-method.schema';

export type ExpenseAttributionMode = 'calendar' | 'cash_impact';

export interface ExpenseAttributionSource {
  expenseDate: Date | string;
  billingCycleLabel?: string | null;
  paymentMethodId?: { toString(): string } | string | null;
  cardId?: { toString(): string } | string | null;
}

export interface PaymentMethodAttributionContext {
  kind?: PaymentMethodKind;
  closingDay?: number;
}

function resolvePaymentMethodId(
  expense: ExpenseAttributionSource,
): string | undefined {
  if (expense.paymentMethodId != null) {
    return String(expense.paymentMethodId);
  }
  if (expense.cardId != null) {
    return String(expense.cardId);
  }
  return undefined;
}

export function getExpenseAttributionYearMonth(
  expense: ExpenseAttributionSource,
  mode: ExpenseAttributionMode,
  paymentMethod?: PaymentMethodAttributionContext | null,
): string {
  const expenseDate = new Date(expense.expenseDate);
  const calendarMonth = getYearMonthFromDate(expenseDate);

  if (mode === 'calendar') {
    return calendarMonth;
  }

  const isCreditWithClosing =
    paymentMethod?.kind === PaymentMethodKind.CREDIT &&
    paymentMethod.closingDay != null;

  if (isCreditWithClosing) {
    return (
      expense.billingCycleLabel ??
      resolveCycleClosingMonth(expenseDate, paymentMethod.closingDay!)
    );
  }

  return calendarMonth;
}

export function expenseBelongsToYearMonth(
  expense: ExpenseAttributionSource,
  yearMonth: string,
  mode: ExpenseAttributionMode,
  paymentMethodMap: Map<string, PaymentMethodAttributionContext>,
): boolean {
  const paymentMethodId = resolvePaymentMethodId(expense);
  const paymentMethod = paymentMethodId
    ? paymentMethodMap.get(paymentMethodId)
    : undefined;

  return (
    getExpenseAttributionYearMonth(expense, mode, paymentMethod) === yearMonth
  );
}
