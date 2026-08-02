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
});
