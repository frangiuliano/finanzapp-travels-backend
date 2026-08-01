import { BadRequestException } from '@nestjs/common';
import { parseYearMonth } from './parse-year-month';

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
