import { BadRequestException } from '@nestjs/common';

const YEAR_MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

export interface YearMonthRange {
  from: string;
  toExclusive: string;
}

export function parseYearMonth(yearMonth: string): YearMonthRange {
  if (!YEAR_MONTH_PATTERN.test(yearMonth)) {
    throw new BadRequestException(
      'yearMonth debe tener formato YYYY-MM (ej. 2026-07)',
    );
  }

  const [yearStr, monthStr] = yearMonth.split('-');
  const year = Number(yearStr);
  const month = Number(monthStr);

  const from = `${yearMonth}-01`;

  if (month === 12) {
    return { from, toExclusive: `${year + 1}-01-01` };
  }

  const nextMonth = String(month + 1).padStart(2, '0');
  return { from, toExclusive: `${year}-${nextMonth}-01` };
}

export function getCurrentYearMonth(date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}

export function shiftYearMonth(yearMonth: string, deltaMonths: number): string {
  const [yearStr, monthStr] = yearMonth.split('-');
  const date = new Date(Number(yearStr), Number(monthStr) - 1 + deltaMonths, 1);
  return getCurrentYearMonth(date);
}

export function monthsBetweenYearMonths(
  fromYearMonth: string,
  toYearMonth: string,
): number {
  const [fromYear, fromMonth] = fromYearMonth.split('-').map(Number);
  const [toYear, toMonth] = toYearMonth.split('-').map(Number);
  return (toYear - fromYear) * 12 + (toMonth - fromMonth);
}

/**
 * YYYY-MM for a date-only value (e.g. Goal.targetDate), read in UTC.
 *
 * A date-only string like "2027-06-01" is parsed by `new Date(...)` as UTC
 * midnight. Reading it back with the *local* getters (as getCurrentYearMonth
 * does — correctly, for real "now" timestamps) rolls it back a calendar day
 * on any server running west of UTC (e.g. Argentina, UTC-3), turning June 1
 * 00:00 UTC into May 31 in local time and silently shifting the target
 * month by one. Always use this — not getCurrentYearMonth — for a stored
 * date-only field.
 */
export function yearMonthFromUtcDate(date: Date): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}

/** Number of real calendar days in a given YYYY-MM month (handles leap years). */
export function daysInYearMonth(yearMonth: string): number {
  const [yearStr, monthStr] = yearMonth.split('-');
  const year = Number(yearStr);
  const month = Number(monthStr);
  return new Date(year, month, 0).getDate();
}
