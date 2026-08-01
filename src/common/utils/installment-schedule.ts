export function monthsBetweenYearMonths(
  startYearMonth: string,
  targetYearMonth: string,
): number {
  const [startYear, startMonth] = startYearMonth.split('-').map(Number);
  const [targetYear, targetMonth] = targetYearMonth.split('-').map(Number);
  return (targetYear - startYear) * 12 + (targetMonth - startMonth);
}

export interface InstallmentDueInMonth {
  installmentNumber: number;
  amount: number;
  dayOfMonth: number;
}

export function getInstallmentDueInMonth(
  plan: {
    startYearMonth: string;
    totalInstallments: number;
    paidInstallments: number;
    installmentAmount: number;
    dayOfMonth: number;
    isActive: boolean;
  },
  yearMonth: string,
): InstallmentDueInMonth | null {
  if (!plan.isActive) return null;

  const monthsDiff = monthsBetweenYearMonths(plan.startYearMonth, yearMonth);
  if (monthsDiff < 0) return null;

  const installmentNumber = monthsDiff + 1;
  if (installmentNumber > plan.totalInstallments) return null;
  if (installmentNumber <= plan.paidInstallments) return null;

  const [yearStr, monthStr] = yearMonth.split('-');
  const lastDay = new Date(Number(yearStr), Number(monthStr), 0).getDate();
  if (plan.dayOfMonth > lastDay) return null;

  return {
    installmentNumber,
    amount: plan.installmentAmount,
    dayOfMonth: plan.dayOfMonth,
  };
}
