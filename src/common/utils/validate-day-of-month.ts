import { BadRequestException } from '@nestjs/common';

export function assertValidDayOfMonth(day: number, field = 'dayOfMonth'): void {
  if (!Number.isInteger(day) || day < 1 || day > 31) {
    throw new BadRequestException(`${field} debe ser un entero entre 1 y 31`);
  }
}

export function normalizeDaysOfMonth(days: number[]): number[] {
  if (!Array.isArray(days) || days.length === 0) {
    throw new BadRequestException(
      'daysOfMonth debe tener al menos un día del mes',
    );
  }

  const normalized = [...new Set(days.map((day) => Math.trunc(day)))].sort(
    (a, b) => a - b,
  );

  for (const day of normalized) {
    assertValidDayOfMonth(day, 'daysOfMonth');
  }

  return normalized;
}

export function getValidDaysInMonth(
  daysOfMonth: number[],
  yearMonth: string,
): number[] {
  const [yearStr, monthStr] = yearMonth.split('-');
  const year = Number(yearStr);
  const month = Number(monthStr);
  const lastDay = new Date(year, month, 0).getDate();

  return daysOfMonth.filter((day) => day <= lastDay);
}
