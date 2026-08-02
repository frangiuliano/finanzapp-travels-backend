export function splitInstallmentAmounts(
  totalAmount: number,
  installments: number,
): number[] {
  if (installments < 1) {
    throw new Error('installments must be at least 1');
  }

  if (installments === 1) {
    return [roundMoney(totalAmount)];
  }

  const base = Math.floor((totalAmount / installments) * 100) / 100;
  const amounts = Array.from({ length: installments }, () => base);
  const sum = roundMoney(base * installments);
  const remainder = roundMoney(totalAmount - sum);
  amounts[installments - 1] = roundMoney(amounts[installments - 1] + remainder);
  return amounts;
}

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}
