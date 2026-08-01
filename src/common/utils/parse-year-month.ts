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
