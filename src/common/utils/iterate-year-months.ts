import { shiftYearMonth } from './parse-year-month';

export function iterateYearMonthsInclusive(
  fromYearMonth: string,
  toYearMonth: string,
): string[] {
  const months: string[] = [];
  let current = fromYearMonth;

  while (current <= toYearMonth) {
    months.push(current);
    current = shiftYearMonth(current, 1);
  }

  return months;
}

export function buildOccurrenceDate(
  yearMonth: string,
  dayOfMonth: number,
): Date {
  const day = String(dayOfMonth).padStart(2, '0');
  return new Date(`${yearMonth}-${day}T12:00:00.000Z`);
}

export function getYearMonthFromDate(date: Date): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}
