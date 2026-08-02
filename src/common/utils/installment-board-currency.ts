export interface InstallmentPlanCurrencyFields {
  installmentAmount: number;
  currency: string;
  fxRateToBoardCurrency?: number | null;
}

export function getInstallmentAmountInBoardCurrency(
  plan: InstallmentPlanCurrencyFields,
  boardCurrency: string,
): number | null {
  if (plan.currency === boardCurrency) {
    return plan.installmentAmount;
  }

  if (plan.fxRateToBoardCurrency != null && plan.fxRateToBoardCurrency > 0) {
    return plan.installmentAmount * plan.fxRateToBoardCurrency;
  }

  return null;
}
