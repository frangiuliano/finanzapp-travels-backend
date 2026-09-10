import { resolveAmountForYearMonth } from './resolve-recurring-amount';

describe('resolveAmountForYearMonth', () => {
  const versions = [
    { effectiveFrom: '2025-01', amount: 1000 },
    { effectiveFrom: '2026-03', amount: 1200 },
  ];

  it('returns amount for the active version in a month', () => {
    expect(resolveAmountForYearMonth(versions, '2026-02')).toBe(1000);
    expect(resolveAmountForYearMonth(versions, '2026-03')).toBe(1200);
    expect(resolveAmountForYearMonth(versions, '2026-12')).toBe(1200);
  });

  it('returns null when there are no versions', () => {
    expect(resolveAmountForYearMonth([], '2026-01')).toBeNull();
  });

  describe('with percent escalation', () => {
    const singleVersion = [{ effectiveFrom: '2026-01', amount: 1000 }];

    it('does not escalate before the first frequency interval elapses', () => {
      expect(
        resolveAmountForYearMonth(singleVersion, '2026-02', {
          type: 'percent',
          value: 10,
          frequencyMonths: 3,
        }),
      ).toBe(1000);
    });

    it('applies one step of escalation once the interval elapses', () => {
      expect(
        resolveAmountForYearMonth(singleVersion, '2026-04', {
          type: 'percent',
          value: 10,
          frequencyMonths: 3,
        }),
      ).toBe(1100);
    });

    it('compounds across multiple elapsed intervals', () => {
      expect(
        resolveAmountForYearMonth(singleVersion, '2026-10', {
          type: 'percent',
          value: 10,
          frequencyMonths: 3,
        }),
      ).toBe(1331);
    });

    it('anchors escalation to the latest matching version, not the first', () => {
      expect(
        resolveAmountForYearMonth(versions, '2026-09', {
          type: 'percent',
          value: 10,
          frequencyMonths: 3,
        }),
      ).toBe(1452);
    });

    it('ignores escalation config with a zero or negative value/frequency', () => {
      expect(
        resolveAmountForYearMonth(singleVersion, '2026-12', {
          type: 'percent',
          value: 0,
          frequencyMonths: 3,
        }),
      ).toBe(1000);
      expect(
        resolveAmountForYearMonth(singleVersion, '2026-12', {
          type: 'percent',
          value: 10,
          frequencyMonths: 0,
        }),
      ).toBe(1000);
    });
  });

  describe('with fixed-amount escalation', () => {
    const singleVersion = [{ effectiveFrom: '2026-01', amount: 1000 }];

    it('adds a fixed amount per elapsed interval instead of compounding', () => {
      expect(
        resolveAmountForYearMonth(singleVersion, '2026-04', {
          type: 'fixed',
          value: 500,
          frequencyMonths: 3,
        }),
      ).toBe(1500);
      expect(
        resolveAmountForYearMonth(singleVersion, '2026-10', {
          type: 'fixed',
          value: 500,
          frequencyMonths: 3,
        }),
      ).toBe(2500);
    });
  });
});
