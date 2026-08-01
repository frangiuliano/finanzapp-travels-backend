export interface ExpenseCurrencyFields {
  amount: number;
  currency: string;
  fxRateToBoardCurrency?: number | null;
}

/**
 * Returns the expense amount expressed in the board's base currency.
 * - Same currency: returns the raw amount.
 * - Different currency with FX snapshot: returns amount * fxRate.
 * - Different currency without snapshot (legacy): returns null.
 */
export function getExpenseAmountInBoardCurrency(
  expense: ExpenseCurrencyFields,
  boardCurrency: string,
): number | null {
  if (expense.currency === boardCurrency) {
    return expense.amount;
  }

  if (
    expense.fxRateToBoardCurrency != null &&
    expense.fxRateToBoardCurrency > 0
  ) {
    return expense.amount * expense.fxRateToBoardCurrency;
  }

  return null;
}
