import { getOccurrenceDayInMonth } from './validate-day-of-month';

describe('getOccurrenceDayInMonth', () => {
  it('keeps the configured day when it exists in the month', () => {
    expect(getOccurrenceDayInMonth(15, '2026-03')).toBe(15);
  });

  it('clamps to the last day of February on a non-leap year', () => {
    expect(getOccurrenceDayInMonth(30, '2026-02')).toBe(28);
  });

  it('clamps to the last day of February on a leap year', () => {
    expect(getOccurrenceDayInMonth(30, '2028-02')).toBe(29);
  });

  it('clamps day 31 to 30 in months with 30 days', () => {
    expect(getOccurrenceDayInMonth(31, '2026-04')).toBe(30);
  });
});
