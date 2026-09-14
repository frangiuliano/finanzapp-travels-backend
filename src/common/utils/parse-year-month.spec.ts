import { BadRequestException } from '@nestjs/common';
import {
  daysInYearMonth,
  getCurrentYearMonth,
  parseYearMonth,
  shiftYearMonth,
} from './parse-year-month';

describe('parseYearMonth', () => {
  it('should parse a valid year-month', () => {
    expect(parseYearMonth('2026-07')).toEqual({
      from: '2026-07-01',
      toExclusive: '2026-08-01',
    });
  });

  it('should roll over December to January next year', () => {
    expect(parseYearMonth('2026-12')).toEqual({
      from: '2026-12-01',
      toExclusive: '2027-01-01',
    });
  });

  it('should reject invalid month', () => {
    expect(() => parseYearMonth('2026-13')).toThrow(BadRequestException);
  });

  it('should reject malformed input', () => {
    expect(() => parseYearMonth('202607')).toThrow(BadRequestException);
  });
});

describe('shiftYearMonth', () => {
  it('should shift forward within the same year', () => {
    expect(shiftYearMonth('2026-07', 2)).toBe('2026-09');
  });

  it('should roll over to the next year', () => {
    expect(shiftYearMonth('2026-11', 2)).toBe('2027-01');
  });

  it('should shift backward across years', () => {
    expect(shiftYearMonth('2026-01', -1)).toBe('2025-12');
  });
});

describe('getCurrentYearMonth', () => {
  it('should format year and month', () => {
    expect(getCurrentYearMonth(new Date(2026, 7, 15))).toBe('2026-08');
  });
});

describe('daysInYearMonth', () => {
  it('should return 31 for a 31-day month', () => {
    expect(daysInYearMonth('2026-07')).toBe(31);
  });

  it('should return 30 for a 30-day month', () => {
    expect(daysInYearMonth('2026-04')).toBe(30);
  });

  it('should return 28 for February in a non-leap year', () => {
    expect(daysInYearMonth('2026-02')).toBe(28);
  });

  it('should return 29 for February in a leap year', () => {
    expect(daysInYearMonth('2024-02')).toBe(29);
  });
});
