import { BadRequestException } from '@nestjs/common';
import {
  getCreditCycleRange,
  getCurrentCycleClosingMonth,
  resolveCycleClosingMonth,
  listRecentCycleLabels,
} from './credit-cycle';

describe('credit-cycle', () => {
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
    expect(() => getCreditCycleRange('2026-08', 31)).toThrow(
      BadRequestException,
    );
  });
});
