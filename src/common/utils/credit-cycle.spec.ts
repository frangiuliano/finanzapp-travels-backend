import { BadRequestException } from '@nestjs/common';
import {
  getCreditCycleRange,
  getCurrentCycleClosingMonth,
  getNextCycleStart,
  isExpenseOnClosingDay,
  resolveCycleClosingMonth,
  listRecentCycleLabels,
} from './credit-cycle';

describe('credit-cycle', () => {
  it('should start the next cycle on the day after the previous closing', () => {
    expect(getNextCycleStart('2026-08-16')).toBe('2026-08-17');
    expect(getNextCycleStart('2026-12-31')).toBe('2027-01-01');
  });

  describe('resolveCycleClosingMonth', () => {
    it('should assign expense on closing day to that month cycle', () => {
      expect(
        resolveCycleClosingMonth(new Date('2026-08-14T12:00:00.000Z'), 14),
      ).toBe('2026-08');
    });

    it('should assign expense after closing day to next month cycle', () => {
      expect(
        resolveCycleClosingMonth(new Date('2026-08-15T12:00:00.000Z'), 14),
      ).toBe('2026-09');
    });

    it('should roll December into January next year', () => {
      expect(
        resolveCycleClosingMonth(new Date('2026-12-20T12:00:00.000Z'), 14),
      ).toBe('2027-01');
    });
  });

  describe('getCreditCycleRange', () => {
    it('should return Jul 15–Aug 14 for August 2026 cycle with closingDay 14', () => {
      expect(getCreditCycleRange('2026-08', 14)).toEqual({
        from: '2026-07-15',
        toExclusive: '2026-08-15',
        periodToInclusive: '2026-08-14',
        cycleLabel: '2026-08',
      });
    });

    it('should handle January cycle crossing year boundary', () => {
      expect(getCreditCycleRange('2027-01', 14)).toEqual({
        from: '2026-12-15',
        toExclusive: '2027-01-15',
        periodToInclusive: '2027-01-14',
        cycleLabel: '2027-01',
      });
    });
  });

  describe('getCurrentCycleClosingMonth', () => {
    it('should resolve current cycle from reference date', () => {
      expect(
        getCurrentCycleClosingMonth(14, new Date('2026-08-01T00:00:00.000Z')),
      ).toBe('2026-08');
    });
  });

  describe('listRecentCycleLabels', () => {
    it('should return descending recent labels', () => {
      const labels = listRecentCycleLabels(
        14,
        3,
        new Date('2026-08-01T00:00:00.000Z'),
      );
      expect(labels).toEqual(['2026-08', '2026-07', '2026-06']);
    });
  });

  it('should reject invalid closingDay', () => {
    expect(() => getCreditCycleRange('2026-08', 32)).toThrow(
      BadRequestException,
    );
    expect(() => getCreditCycleRange('2026-08', 0)).toThrow(
      BadRequestException,
    );
  });

  describe('closing days beyond 28 (short-month clamping)', () => {
    it('should clamp closingDay 30 to Feb 28 in a non-leap year', () => {
      expect(getCreditCycleRange('2027-02', 30)).toEqual({
        from: '2027-01-31',
        toExclusive: '2027-03-01',
        periodToInclusive: '2027-02-28',
        cycleLabel: '2027-02',
      });
    });

    it('should clamp closingDay 30 to Feb 29 in a leap year', () => {
      expect(getCreditCycleRange('2028-02', 30)).toEqual({
        from: '2028-01-31',
        toExclusive: '2028-03-01',
        periodToInclusive: '2028-02-29',
        cycleLabel: '2028-02',
      });
    });

    it('should keep closingDay 30 for a 30-day month', () => {
      expect(getCreditCycleRange('2026-04', 30)).toEqual({
        from: '2026-03-31',
        toExclusive: '2026-05-01',
        periodToInclusive: '2026-04-30',
        cycleLabel: '2026-04',
      });
    });

    it('should assign an expense on Feb 28 to the Feb cycle when closingDay is 30', () => {
      expect(
        resolveCycleClosingMonth(new Date('2027-02-28T12:00:00.000Z'), 30),
      ).toBe('2027-02');
    });

    it('should assign an expense on Mar 1 to the Mar cycle when closingDay is 30', () => {
      expect(
        resolveCycleClosingMonth(new Date('2027-03-01T12:00:00.000Z'), 30),
      ).toBe('2027-03');
    });
  });

  describe('isExpenseOnClosingDay', () => {
    it('should be true when the expense date matches the closing day', () => {
      expect(
        isExpenseOnClosingDay(new Date('2026-08-14T12:00:00.000Z'), 14),
      ).toBe(true);
    });

    it('should be false for any other day', () => {
      expect(
        isExpenseOnClosingDay(new Date('2026-08-13T12:00:00.000Z'), 14),
      ).toBe(false);
      expect(
        isExpenseOnClosingDay(new Date('2026-08-15T12:00:00.000Z'), 14),
      ).toBe(false);
    });

    it('should match a clamped closing day in a short month', () => {
      expect(
        isExpenseOnClosingDay(new Date('2027-02-28T12:00:00.000Z'), 30),
      ).toBe(true);
      expect(
        isExpenseOnClosingDay(new Date('2028-02-29T12:00:00.000Z'), 30),
      ).toBe(true);
    });
  });
});
