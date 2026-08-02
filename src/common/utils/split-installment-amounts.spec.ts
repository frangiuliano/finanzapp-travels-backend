import { splitInstallmentAmounts } from './split-installment-amounts';

describe('splitInstallmentAmounts', () => {
  it('should return the full amount for a single installment', () => {
    expect(splitInstallmentAmounts(50000, 1)).toEqual([50000]);
  });

  it('should split evenly when divisible', () => {
    expect(splitInstallmentAmounts(1200, 3)).toEqual([400, 400, 400]);
  });

  it('should put remainder on the last installment', () => {
    expect(splitInstallmentAmounts(100, 3)).toEqual([33.33, 33.33, 33.34]);
  });

  it('should sum to the original total', () => {
    const amounts = splitInstallmentAmounts(50000, 12);
    const sum = amounts.reduce((acc, value) => acc + value, 0);
    expect(sum).toBeCloseTo(50000, 2);
    expect(amounts).toHaveLength(12);
  });
});
