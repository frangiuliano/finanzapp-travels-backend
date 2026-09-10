export interface RecurringAmountVersion {
  effectiveFrom: string;
  amount: number;
}

export interface RecurringEscalation {
  /** 'percent' = grows by `value`% every interval (compounded). 'fixed' = adds `value` every interval (linear). */
  type: 'percent' | 'fixed';
  value: number;
  /** How often the increase is applied, in months (e.g. 3 = every 3 months). */
  frequencyMonths: number;
}

function diffMonths(fromYearMonth: string, toYearMonth: string): number {
  const [fromYear, fromMonth] = fromYearMonth.split('-').map(Number);
  const [toYear, toMonth] = toYearMonth.split('-').map(Number);
  return (toYear - fromYear) * 12 + (toMonth - fromMonth);
}

export function resolveAmountForYearMonth(
  versions: RecurringAmountVersion[],
  yearMonth: string,
  escalation?: RecurringEscalation | null,
): number | null {
  if (versions.length === 0) {
    return null;
  }

  const sorted = [...versions].sort((a, b) =>
    b.effectiveFrom.localeCompare(a.effectiveFrom),
  );

  const match =
    sorted.find((version) => version.effectiveFrom <= yearMonth) ??
    sorted[sorted.length - 1];

  if (!match) {
    return null;
  }

  if (
    !escalation ||
    !(escalation.value > 0) ||
    !(escalation.frequencyMonths > 0)
  ) {
    return match.amount;
  }

  const monthsElapsed = diffMonths(match.effectiveFrom, yearMonth);
  const steps = Math.floor(monthsElapsed / escalation.frequencyMonths);

  if (steps <= 0) {
    return match.amount;
  }

  if (escalation.type === 'percent') {
    const factor = Math.pow(1 + escalation.value / 100, steps);
    return Math.round(match.amount * factor * 100) / 100;
  }

  return Math.round((match.amount + escalation.value * steps) * 100) / 100;
}
