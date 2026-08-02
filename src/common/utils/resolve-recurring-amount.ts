export interface RecurringAmountVersion {
  effectiveFrom: string;
  amount: number;
}

export function resolveAmountForYearMonth(
  versions: RecurringAmountVersion[],
  yearMonth: string,
): number | null {
  if (versions.length === 0) {
    return null;
  }

  const sorted = [...versions].sort((a, b) =>
    b.effectiveFrom.localeCompare(a.effectiveFrom),
  );

  const match = sorted.find((version) => version.effectiveFrom <= yearMonth);
  return match?.amount ?? sorted[sorted.length - 1]?.amount ?? null;
}
