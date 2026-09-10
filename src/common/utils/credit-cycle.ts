import { BadRequestException } from '@nestjs/common';

const YEAR_MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

export interface CreditCycleRange {
  /** Inclusive start date (YYYY-MM-DD). */
  from: string;
  /** Exclusive end boundary for queries (YYYY-MM-DD). */
  toExclusive: string;
  /** Inclusive end date (YYYY-MM-DD). */
  periodToInclusive: string;
  /** Closing month label (YYYY-MM). */
  cycleLabel: string;
}

function padMonth(month: number): string {
  return String(month).padStart(2, '0');
}

function padDay(day: number): string {
  return String(day).padStart(2, '0');
}

function addUtcDays(dateStr: string, days: number): string {
  const date = new Date(`${dateStr}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** Number of days in a given month (month is 1-indexed). */
function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/**
 * Resolves the actual closing date (YYYY-MM-DD) for a given month, clamping
 * closingDay to that month's last day when the month is shorter (e.g. a
 * closingDay of 30 or 31 closes on Feb 28/29 in February).
 */
function getClosingDateForMonth(
  year: number,
  month: number,
  closingDay: number,
): string {
  const day = Math.min(closingDay, daysInMonth(year, month));
  return `${year}-${padMonth(month)}-${padDay(day)}`;
}

export function getNextCycleStart(closingDate: string): string {
  return addUtcDays(closingDate, 1);
}

/**
 * True when expenseDate falls exactly on the card's closing day for its
 * month (clamped to the month's last day for short months). Used to flag
 * expenses whose cycle assignment can't be confirmed until the real
 * statement arrives.
 */
export function isExpenseOnClosingDay(
  expenseDate: Date,
  closingDay: number,
): boolean {
  const year = expenseDate.getUTCFullYear();
  const month = expenseDate.getUTCMonth() + 1;
  const day = expenseDate.getUTCDate();
  return day === Math.min(closingDay, daysInMonth(year, month));
}

export function assertValidClosingDay(closingDay: number): void {
  if (!Number.isInteger(closingDay) || closingDay < 1 || closingDay > 31) {
    throw new BadRequestException('closingDay debe ser un entero entre 1 y 31');
  }
}

export function assertValidCycleLabel(cycleLabel: string): void {
  if (!YEAR_MONTH_PATTERN.test(cycleLabel)) {
    throw new BadRequestException(
      'cycle debe ser "current" o YYYY-MM (mes de cierre del ciclo)',
    );
  }
}

/**
 * Returns the closing-month label (YYYY-MM) for an expense in a credit cycle.
 * Example: closingDay=14, expense on 2026-08-10 → cycle 2026-08 (Jul 15–Aug 14).
 */
export function resolveCycleClosingMonth(
  expenseDate: Date,
  closingDay: number,
): string {
  assertValidClosingDay(closingDay);

  const year = expenseDate.getUTCFullYear();
  const month = expenseDate.getUTCMonth() + 1;
  const day = expenseDate.getUTCDate();
  const effectiveClosingDay = Math.min(closingDay, daysInMonth(year, month));

  if (day <= effectiveClosingDay) {
    return `${year}-${padMonth(month)}`;
  }

  if (month === 12) {
    return `${year + 1}-01`;
  }

  return `${year}-${padMonth(month + 1)}`;
}

export function getCurrentCycleClosingMonth(
  closingDay: number,
  referenceDate: Date = new Date(),
): string {
  return resolveCycleClosingMonth(referenceDate, closingDay);
}

/**
 * Date range for a credit card billing cycle that closes on closingDay of cycleLabel month.
 */
export function getCreditCycleRange(
  cycleLabel: string,
  closingDay: number,
): CreditCycleRange {
  assertValidCycleLabel(cycleLabel);
  assertValidClosingDay(closingDay);

  const [yearStr, monthStr] = cycleLabel.split('-');
  const year = Number(yearStr);
  const month = Number(monthStr);

  let prevMonth = month - 1;
  let prevYear = year;
  if (prevMonth === 0) {
    prevMonth = 12;
    prevYear = year - 1;
  }

  const from = getNextCycleStart(
    getClosingDateForMonth(prevYear, prevMonth, closingDay),
  );
  const periodToInclusive = getClosingDateForMonth(year, month, closingDay);
  const toExclusive = addUtcDays(periodToInclusive, 1);

  return {
    from,
    toExclusive,
    periodToInclusive,
    cycleLabel,
  };
}

/** Last N closing-month labels ending at the current cycle (inclusive). */
export function listRecentCycleLabels(
  closingDay: number,
  count: number,
  referenceDate: Date = new Date(),
): string[] {
  assertValidClosingDay(closingDay);

  const labels: string[] = [];
  let cursor = getCurrentCycleClosingMonth(closingDay, referenceDate);

  for (let i = 0; i < count; i += 1) {
    labels.push(cursor);
    const [yearStr, monthStr] = cursor.split('-');
    let year = Number(yearStr);
    let month = Number(monthStr) - 1;
    if (month === 0) {
      month = 12;
      year -= 1;
    }
    cursor = `${year}-${padMonth(month)}`;
  }

  return labels;
}

/** True when the reference date is on or after the cycle's closing date. */
export function isCycleClosed(
  cycleLabel: string,
  closingDay: number,
  referenceDate: Date = new Date(),
): boolean {
  const { periodToInclusive } = getCreditCycleRange(cycleLabel, closingDay);
  const ref = referenceDate.toISOString().slice(0, 10);
  return ref >= periodToInclusive;
}
